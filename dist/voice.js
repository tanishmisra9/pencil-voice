// The voice: one AudioContext + the pencil synth (an AudioWorklet), played from the pen tip's motion.
//
//   where      pan follows the tip across the viewport
//   direction  brighter on upstrokes, darker and fuller on downstrokes; a downstroke presses harder
//   curvature  lighter through tight curves
//   speed      level (with a floor: any movement is audible) and paper-tooth crackle per px travelled
//   events     a tick at sharp turns, a touch where the pen lands; a release once the tip stops
//
// Browsers only let audio start after a user gesture, and scrolling never counts as one, so the voice stays silent
// until the first pointerdown / keydown / touchend, and re-arms that unlock if iOS interrupts the context. Every call
// is a cheap no-op until the context is running and the worklet has loaded.
import { graphite } from "./presets.js";
const UNLOCK = ["pointerdown", "keydown", "touchend"];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** The processor-side knobs (sent to the worklet); the rest are read by `move`. */
const PROCESSOR_KEYS = ["bands", "hp", "outGain", "tooth", "toothFreq", "toothDecay"];
// addModule must run once per context: registering "pencil-voice" twice in the same worklet scope throws.
const loaded = new WeakMap();
/** Loads the synth into `ctx` (once per context). Exposed for offline rendering (OfflineAudioContext). */
export function loadPencilProcessor(ctx, processorUrl) {
    let p = loaded.get(ctx);
    if (!p) {
        p = ctx.audioWorklet.addModule(processorUrl ?? new URL("./pencil-processor.js", import.meta.url));
        loaded.set(ctx, p);
    }
    return p;
}
/** Makes the synth node (after `loadPencilProcessor`). Exposed for offline rendering and custom graphs. */
export function createPencilNode(ctx, config) {
    const processorOptions = Object.fromEntries(PROCESSOR_KEYS.map((k) => [k, config[k]]));
    return new AudioWorkletNode(ctx, "pencil-voice", { numberOfInputs: 0, outputChannelCount: [1], processorOptions });
}
function noop(config) {
    return {
        config,
        context: null,
        ready: Promise.resolve(false),
        move() { },
        tick() { },
        touch() { },
        configure(c) {
            Object.assign(config, c);
        },
        dispose() { },
    };
}
export function createPencilVoice(options = {}) {
    const config = { ...(options.preset ?? graphite), ...options.config };
    const warn = options.onWarn ?? ((m) => console.warn(m));
    if (typeof window === "undefined")
        return noop(config); // server render: nothing to do
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC && !options.audioContext) {
        warn("[pencil-voice] Web Audio is not available; the pencil is silent.");
        return noop(config);
    }
    const owned = !options.audioContext;
    const ctx = options.audioContext ?? new AC();
    if (!ctx.audioWorklet) {
        // AudioWorklet exists only in a secure context: e.g. a phone opening a dev server at http://192.168… gets none.
        warn(`[pencil-voice] AudioWorklet is not available${window.isSecureContext ? "" : " (insecure context: serve over https or localhost)"}; the pencil is silent.`);
        if (owned)
            void ctx.close().catch(() => { });
        return noop(config);
    }
    const panner = ctx.createStereoPanner();
    panner.connect(ctx.destination);
    let node = null;
    let closed = false;
    const ready = loadPencilProcessor(ctx, options.processorUrl).then(() => {
        if (closed)
            return false;
        node = createPencilNode(ctx, config);
        node.connect(panner);
        return true;
    }, (e) => {
        warn(`[pencil-voice] could not load the synth worklet: ${e}`);
        return false;
    });
    const events = options.unlockEvents ?? UNLOCK;
    const running = () => ctx.state === "running";
    const listen = () => events.forEach((e) => window.addEventListener(e, unlock, true));
    const unlisten = () => events.forEach((e) => window.removeEventListener(e, unlock, true));
    const unlock = () => {
        ctx.resume().then(() => {
            if (running())
                unlisten();
        }, () => { });
    };
    // iOS suspends ("interrupted") the context on an app switch or a call: re-arm the unlock so the next tap revives it.
    const onState = () => {
        if (ctx.state !== "running" && ctx.state !== "closed")
            listen();
    };
    ctx.addEventListener("statechange", onState);
    if (!running())
        listen();
    const param = (name) => node?.parameters.get(name);
    const live = () => node !== null && running();
    let release;
    return {
        config,
        context: ctx,
        ready,
        move(m) {
            if (!live() || !(m.speed > 0))
                return;
            const s = config;
            const t = ctx.currentTime;
            const tight = 1 - 1 / (1 + s.curvatureScale * Math.abs(m.curvature)); // 0 straight … →1 tight
            const level = (s.floor + (s.max - s.floor) * clamp(m.speed / s.fullSpeed, 0, 1)) * (1 + s.downWeight * m.down) * (1 - s.curvatureSoft * tight);
            param("pressure")?.setTargetAtTime(level, t, s.attack);
            param("brightness")?.setTargetAtTime(-m.down * s.brightness, t, 0.03);
            param("toothRate")?.setTargetAtTime(m.speed * s.toothPerPx, t, 0.02);
            panner.pan.setTargetAtTime(clamp(s.pan * ((m.x / Math.max(1, m.viewport)) * 2 - 1), -1, 1), t, 0.05);
            clearTimeout(release);
            release = setTimeout(() => {
                const now = ctx.currentTime;
                param("pressure")?.setTargetAtTime(0, now, s.release);
                param("toothRate")?.setTargetAtTime(0, now, s.release);
            }, s.releaseAfterMs);
        },
        tick() {
            if (live())
                node.port.postMessage({ type: "burst", amp: config.tick });
        },
        touch() {
            if (live())
                node.port.postMessage({ type: "burst", amp: config.touch });
        },
        configure(c) {
            Object.assign(config, c);
            const forProcessor = Object.fromEntries(PROCESSOR_KEYS.filter((k) => k in c).map((k) => [k, config[k]]));
            if (Object.keys(forProcessor).length) {
                void ready.then(() => node?.port.postMessage({ type: "config", ...forProcessor }));
            }
        },
        dispose() {
            closed = true;
            clearTimeout(release);
            ctx.removeEventListener("statechange", onState);
            unlisten();
            node?.disconnect();
            panner.disconnect();
            if (owned)
                void ctx.close().catch(() => { });
        },
    };
}

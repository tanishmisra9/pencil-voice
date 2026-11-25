import { type PencilConfig } from "./presets.js";
export type PencilMove = {
    /** The tip's x in viewport (CSS) px, and the viewport width, for pan. */
    x: number;
    viewport: number;
    /** Tip travel in px/s. */
    speed: number;
    /** −1 straight up … 1 straight down. */
    down: number;
    /** Signed curvature, 1/px. */
    curvature: number;
};
export type PencilVoiceOptions = {
    /** Overrides on top of `graphite` (or on top of `preset`). Any subset of the knobs. */
    config?: Partial<PencilConfig>;
    /** The base sound. Default `graphite`. */
    preset?: PencilConfig;
    /** Share an existing context (it is never closed by `dispose`). Default: the voice makes its own. */
    audioContext?: AudioContext;
    /**
     * Where to load the synth from. Default: `pencil-processor.js` next to this module, which bundlers (webpack 5,
     * Next.js, Vite, Rollup, esbuild) emit as its own cacheable file. Pass a URL if you host the file yourself.
     */
    processorUrl?: string | URL;
    /** Events that unlock audio. Default pointerdown, keydown, touchend (all real user gestures). */
    unlockEvents?: string[];
    /** Called when the voice can't make sound (no Web Audio, no AudioWorklet, worklet failed to load). Default console.warn. */
    onWarn?: (message: string) => void;
};
export type PencilVoice = {
    /** The live config (preset + overrides + anything passed to `configure`). Treat as read-only. */
    readonly config: PencilConfig;
    /** The AudioContext, or null when the voice is a no-op. */
    readonly context: AudioContext | null;
    /** Resolves true once the synth has loaded (false if it never will). */
    readonly ready: Promise<boolean>;
    /** The tip moved: set level, timbre, crackle and pan from it, and release shortly after the last call. */
    move(m: PencilMove): void;
    /** A short transient: the pen turned sharply. */
    tick(): void;
    /** A short transient: the pen landed. */
    touch(): void;
    /** Change any knobs live. */
    configure(config: Partial<PencilConfig>): void;
    /** Stop, disconnect and close (the context only if the voice made it). */
    dispose(): void;
};
/** Loads the synth into `ctx` (once per context). Exposed for offline rendering (OfflineAudioContext). */
export declare function loadPencilProcessor(ctx: BaseAudioContext, processorUrl?: string | URL): Promise<void>;
/** Makes the synth node (after `loadPencilProcessor`). Exposed for offline rendering and custom graphs. */
export declare function createPencilNode(ctx: BaseAudioContext, config: PencilConfig): AudioWorkletNode;
export declare function createPencilVoice(options?: PencilVoiceOptions): PencilVoice;

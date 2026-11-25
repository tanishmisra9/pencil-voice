// Follows one stroke as it is drawn and voices it. You push the drawn fraction (0…1) whenever it changes, from
// whatever drives your drawing: scroll, a pointer, a timeline. This module never listens to scroll, never runs its own
// animation loop and never reads layout per call, so it adds no per-frame work beyond a binary search and a few
// AudioParam updates.
import { createStroke } from "./stroke.js";
/** Longest gap (ms) used for speed: after a pause, the first move must not be divided by the whole idle time. */
const MAX_DT = 50;
export function followStroke(voice, d, options = {}) {
    const stroke = createStroke(d, options);
    const touchAt = options.touchAt ?? 4;
    const now = options.now ?? (() => performance.now());
    const hasWindow = typeof window !== "undefined";
    // Path x → viewport x as a·x + c·y + e (the element's screen transform), cached.
    let a = 1;
    let c = 0;
    let e = 0;
    let viewport = hasWindow ? window.innerWidth : 1;
    const measure = () => {
        viewport = window.innerWidth;
        const m = options.element?.getScreenCTM?.();
        if (m)
            [a, c, e] = [m.a, m.c, m.e];
        else if (options.element) {
            const r = options.element.getBoundingClientRect();
            [a, c, e] = [1, 0, r.left];
        }
    };
    if (hasWindow && options.element) {
        measure();
        window.addEventListener("resize", measure);
    }
    let prev = -1;
    let lastT = 0;
    return {
        stroke,
        update(progress) {
            const len = Math.max(0, Math.min(1, progress)) * stroke.length;
            const t = now();
            if (voice && prev >= 0 && len > prev) {
                const tip = stroke.tipAt(len);
                const dt = lastT ? Math.min(t - lastT, MAX_DT) : 16;
                voice.move({
                    x: a * tip.x + c * tip.y + e,
                    viewport,
                    speed: ((len - prev) * 1000) / Math.max(1, dt),
                    down: tip.down,
                    curvature: tip.curvature,
                });
                for (const s of stroke.starts)
                    if (prev < s + touchAt && len >= s + touchAt)
                        voice.touch();
                for (const at of stroke.turns)
                    if (at > prev && at <= len)
                        voice.tick();
            }
            if (len !== prev)
                lastT = t;
            prev = len;
        },
        reset() {
            prev = -1;
            lastT = 0;
        },
        dispose() {
            if (hasWindow && options.element)
                window.removeEventListener("resize", measure);
        },
    };
}

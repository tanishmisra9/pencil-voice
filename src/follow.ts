// Follows one stroke as it is drawn and voices it. You push the drawn fraction (0…1) whenever it changes, from
// whatever drives your drawing: scroll, a pointer, a timeline. This module never listens to scroll, never runs its own
// animation loop and never reads layout per call, so it adds no per-frame work beyond a binary search and a few
// AudioParam updates.

import { createStroke, type Stroke, type StrokeOptions } from "./stroke.js";
import type { PencilVoice } from "./voice.js";

/**
 * What a follower needs from a voice: just the three calls. A full `PencilVoice` works, and so does a forwarder that
 * looks the voice up when it's called. You need the forwarder when the voice is created after the follower (e.g. a
 * React parent's effect runs after its children's): `{ move: (m) => ref.current?.move(m), tick: …, touch: … }`.
 */
export type VoiceLike = Pick<PencilVoice, "move" | "tick" | "touch">;

export type FollowOptions = StrokeOptions & {
  /**
   * The element the path is drawn in (the <path> itself, or its <svg>). Used only to place the tip on screen for pan:
   * its screen transform is read once and again on window resize, never per update. Without it, the path's own x is
   * treated as viewport px.
   */
  element?: Element | null;
  /** Path units drawn before the pen "lands" (a touch transient) at the start of each subpath. Default 4. */
  touchAt?: number;
  /** Clock in ms. Default performance.now. */
  now?: () => number;
};

export type StrokeFollower = {
  /** The stroke model (length, turns, tipAt…). */
  readonly stroke: Stroke;
  /** The drawn fraction changed. Only increases make sound; the first value (and the first after `reset`) is silent. */
  update(progress: number): void;
  /** Forget the last position: the next `update` is silent again (use when a stroke restarts from 0). */
  reset(): void;
  /** Stop listening for resize. */
  dispose(): void;
};

/** Longest gap (ms) used for speed: after a pause, the first move must not be divided by the whole idle time. */
const MAX_DT = 50;

export function followStroke(voice: VoiceLike | null | undefined, d: string, options: FollowOptions = {}): StrokeFollower {
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
    const m = (options.element as SVGGraphicsElement | null | undefined)?.getScreenCTM?.();
    if (m) [a, c, e] = [m.a, m.c, m.e];
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
        for (const s of stroke.starts) if (prev < s + touchAt && len >= s + touchAt) voice.touch();
        for (const at of stroke.turns) if (at > prev && at <= len) voice.tick();
      }
      if (len !== prev) lastT = t;
      prev = len;
    },
    reset() {
      prev = -1;
      lastT = 0;
    },
    dispose() {
      if (hasWindow && options.element) window.removeEventListener("resize", measure);
    },
  };
}

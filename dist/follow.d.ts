import { type Stroke, type StrokeOptions } from "./stroke.js";
import type { PencilVoice } from "./voice.js";
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
export declare function followStroke(voice: PencilVoice | null | undefined, d: string, options?: FollowOptions): StrokeFollower;

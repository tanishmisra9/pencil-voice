export type Pt = [number, number];
export type StrokeOptions = {
    /** px between resampled centerline points. Smaller = finer tip readings, more memory. Default 2. */
    sampleStep?: number;
    /** A sharp turn is a heading change above this many degrees… Default 100. */
    tickTurn?: number;
    /** …within this many px of travel. Default 28. */
    tickSpan?: number;
};
export type Tip = {
    /** Position in the path's own coordinate space. */
    x: number;
    y: number;
    /** Heading in radians (SVG coordinates: y grows downward). */
    angle: number;
    /** Downward component of the heading: 1 straight down, −1 straight up, 0 sideways. */
    down: number;
    /** Signed curvature, 1/px (heading change per px of travel). */
    curvature: number;
};
export type Stroke = {
    /** Total drawn length in path units, matching SVG's `getTotalLength()` (moves between subpaths add nothing). */
    length: number;
    pts: Pt[];
    /** Arc length at each point of `pts`. */
    cum: number[];
    /** Arc lengths of the sharp turns. */
    turns: number[];
    /** Arc lengths where the pen lands: 0, then the start of every later subpath. */
    starts: number[];
    /** The tip at `len` along the stroke (clamped to 0…length). */
    tipAt(len: number): Tip;
};
/** Flattens a path into polylines, one per subpath, with curves and arcs sampled about every 1.5 units. */
export declare function samplePath(d: string): Pt[][];
/** Evenly spaced points `step` apart along a polyline (the first and last points are always kept). */
export declare function resample(poly: Pt[], step: number): Pt[];
/** Builds the stroke model from an SVG path `d`. */
export declare function createStroke(d: string, options?: StrokeOptions): Stroke;

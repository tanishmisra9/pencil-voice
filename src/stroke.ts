// The stroke model. An SVG path `d` becomes a densely resampled centerline that knows, at every point of its length,
// where the pen tip is, which way it is heading and how tightly it is turning, plus where its sharp turns are and
// where the pen lands (the start of each subpath). Pure: no DOM, no Web Audio. Built once per path; per frame only
// `tipAt` (a binary search) runs.

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

const DEFAULTS = { sampleStep: 2, tickTurn: 100, tickSpan: 28 };

// ── Path parsing: the full SVG path grammar (M L H V C S Q T A Z, absolute and relative) ──

const NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const CMD = /[MmLlHhVvCcSsQqTtAaZz]/;

/** Flattens a path into polylines, one per subpath, with curves and arcs sampled about every 1.5 units. */
export function samplePath(d: string): Pt[][] {
  const subpaths: Pt[][] = [];
  let sub: Pt[] = [];
  let i = 0;
  let cmd = "";
  let cur: Pt = [0, 0];
  let start: Pt = [0, 0];
  let lastC: Pt | null = null; // previous cubic's second control point (for S)
  let lastQ: Pt | null = null; // previous quadratic's control point (for T)

  const ws = () => {
    while (i < d.length && /[\s,]/.test(d[i])) i++;
  };
  const num = () => {
    ws();
    NUM.lastIndex = i;
    const m = NUM.exec(d);
    if (!m) throw new SyntaxError(`pencil-voice: expected a number at ${i} in path "${d.slice(0, 40)}…"`);
    i = NUM.lastIndex;
    return parseFloat(m[0]);
  };
  const flag = () => {
    ws();
    const c = d[i++];
    if (c !== "0" && c !== "1") throw new SyntaxError(`pencil-voice: expected an arc flag at ${i - 1}`);
    return c === "1";
  };
  const more = () => {
    ws();
    return i < d.length && !CMD.test(d[i]);
  };
  const lineTo = (p: Pt) => {
    sub.push(p);
    cur = p;
  };
  const curveTo = (n: number, at: (t: number) => Pt, end: Pt) => {
    for (let k = 1; k <= n; k++) sub.push(at(k / n));
    sub[sub.length - 1] = end;
    cur = end;
  };

  while (true) {
    ws();
    if (i >= d.length) break;
    if (CMD.test(d[i])) cmd = d[i++];
    else if (!cmd) throw new SyntaxError("pencil-voice: a path must start with a command");
    if (!subpaths.length && !sub.length && cmd.toUpperCase() !== "M") {
      throw new SyntaxError("pencil-voice: a path must start with M (moveto)");
    }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const at = (x: number, y: number): Pt => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
    let keepC = false;
    let keepQ = false;

    if (C === "M") {
      if (sub.length > 1) subpaths.push(sub);
      const p = at(num(), num());
      sub = [p];
      cur = start = p;
      cmd = rel ? "l" : "L"; // further pairs after a moveto are linetos
    } else if (C === "L") {
      lineTo(at(num(), num()));
    } else if (C === "H") {
      const x = num();
      lineTo([rel ? cur[0] + x : x, cur[1]]);
    } else if (C === "V") {
      const y = num();
      lineTo([cur[0], rel ? cur[1] + y : y]);
    } else if (C === "C" || C === "S") {
      const c1: Pt = C === "C" ? at(num(), num()) : lastC ? [2 * cur[0] - lastC[0], 2 * cur[1] - lastC[1]] : cur;
      const c2 = at(num(), num());
      const e = at(num(), num());
      const a = cur;
      curveTo(steps(chord(a, c1, c2, e)), (t) => cubic(a, c1, c2, e, t), e);
      lastC = c2;
      keepC = true;
    } else if (C === "Q" || C === "T") {
      const c: Pt = C === "Q" ? at(num(), num()) : lastQ ? [2 * cur[0] - lastQ[0], 2 * cur[1] - lastQ[1]] : cur;
      const e = at(num(), num());
      const a = cur;
      curveTo(steps(chord(a, c, e)), (t) => quad(a, c, e, t), e);
      lastQ = c;
      keepQ = true;
    } else if (C === "A") {
      const [rx, ry, rot, large, sweep] = [num(), num(), num(), flag(), flag()];
      const e = at(num(), num());
      const arc = arcCenter(cur, e, rx, ry, rot, large, sweep);
      if (!arc) lineTo(e);
      else curveTo(steps(Math.abs(arc.dTheta) * Math.max(arc.rx, arc.ry)), arc.at, e);
    } else if (C === "Z") {
      if (cur[0] !== start[0] || cur[1] !== start[1]) lineTo(start);
      cur = start;
    }
    if (!keepC) lastC = null;
    if (!keepQ) lastQ = null;
    // Numbers after any other command repeat it (the loop goes round with the same `cmd`); after Z they're invalid.
    if (C === "Z" && more()) throw new SyntaxError(`pencil-voice: unexpected number after Z at ${i}`);
  }
  if (sub.length > 1) subpaths.push(sub);
  return subpaths;
}

const steps = (len: number) => Math.max(4, Math.ceil(len / 1.5));
const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const chord = (...p: Pt[]) => p.slice(1).reduce((s, q, k) => s + dist(p[k], q), 0);
function cubic(a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt {
  const u = 1 - t;
  const f = (i: 0 | 1) => u * u * u * a[i] + 3 * u * u * t * b[i] + 3 * u * t * t * c[i] + t * t * t * d[i];
  return [f(0), f(1)];
}
function quad(a: Pt, b: Pt, c: Pt, t: number): Pt {
  const u = 1 - t;
  const f = (i: 0 | 1) => u * u * a[i] + 2 * u * t * b[i] + t * t * c[i];
  return [f(0), f(1)];
}

/** SVG arc endpoint → centre parameterisation (SVG 1.1 implementation notes, F.6.5–F.6.6). Null = draw a line. */
function arcCenter(p0: Pt, p1: Pt, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean) {
  if (rx === 0 || ry === 0 || (p0[0] === p1[0] && p0[1] === p1[1])) return null;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (rotDeg * Math.PI) / 180;
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cx1 = (co * rx * y1) / ry;
  const cy1 = (-co * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dTheta = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
  return {
    rx,
    ry,
    dTheta,
    at: (t: number): Pt => {
      const th = theta1 + dTheta * t;
      const [x, y] = [rx * Math.cos(th), ry * Math.sin(th)];
      return [cos * x - sin * y + cx, sin * x + cos * y + cy];
    },
  };
}

/** Evenly spaced points `step` apart along a polyline (the first and last points are always kept). */
export function resample(poly: Pt[], step: number): Pt[] {
  const pts = poly.filter((p, k) => k === 0 || dist(poly[k - 1], p) > 1e-6);
  if (pts.length < 2) return pts;
  const out: Pt[] = [pts[0]];
  let carry = 0;
  for (let k = 1; k < pts.length; k++) {
    const [a, b] = [pts[k - 1], pts[k]];
    const seg = dist(a, b);
    let at = step - carry;
    while (at <= seg) {
      const t = at / seg;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      at += step;
    }
    carry = seg - (at - step);
  }
  const last = pts[pts.length - 1];
  if (dist(out[out.length - 1], last) > 1e-6) out.push(last);
  return out;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Builds the stroke model from an SVG path `d`. */
export function createStroke(d: string, options: StrokeOptions = {}): Stroke {
  const o = { ...DEFAULTS, ...options };
  const pts: Pt[] = [];
  const cum: number[] = [];
  const angle: number[] = [];
  const curv: number[] = [];
  const starts: number[] = [];
  const turns: number[] = [];
  const limit = (o.tickTurn * Math.PI) / 180;
  const span = o.tickSpan;

  for (const poly of samplePath(d)) {
    const p = resample(poly, o.sampleStep);
    const n = p.length;
    if (n < 2) continue;
    const base = cum.length ? cum[cum.length - 1] : 0; // a moveto between subpaths adds no length
    const c = [base];
    for (let k = 1; k < n; k++) c.push(c[k - 1] + dist(p[k - 1], p[k]));
    // Heading from a centred difference; curvature as heading change per px over a small window. Per subpath, so
    // the jump between subpaths never reads as a turn.
    const a = p.map((_, k) => {
      const [u, v] = [p[Math.max(0, k - 1)], p[Math.min(n - 1, k + 1)]];
      return Math.atan2(v[1] - u[1], v[0] - u[0]);
    });
    const W = 2;
    const cv = p.map((_, k) => {
      const [i, j] = [Math.max(0, k - W), Math.min(n - 1, k + W)];
      const ds = c[j] - c[i];
      return ds > 0 ? wrap(a[j] - a[i]) / ds : 0;
    });
    // Sharp turns: heading change above tickTurn degrees within tickSpan px of travel; nearby hits merged.
    for (let k = 0, j = 0; k < n; k++) {
      while (j < n - 1 && c[j] - c[k] < span) j++;
      let turned = 0;
      for (let m = k + 1; m <= j; m++) turned += wrap(a[m] - a[m - 1]);
      if (Math.abs(turned) > limit) {
        const at = (c[k] + c[j]) / 2;
        if (!turns.length || at - turns[turns.length - 1] > span * 2) turns.push(at);
      }
    }
    starts.push(base);
    pts.push(...p);
    cum.push(...c);
    angle.push(...a);
    curv.push(...cv);
  }

  const n = pts.length;
  const length = n ? cum[n - 1] : 0;
  const down = angle.map((a) => Math.sin(a));

  const indexAt = (len: number) => {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= len) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  return {
    length,
    pts,
    cum,
    turns,
    starts,
    tipAt(len) {
      if (!n) return { x: 0, y: 0, angle: 0, down: 0, curvature: 0 };
      const k = indexAt(clamp(len, 0, length));
      const j = Math.min(n - 1, k + 1);
      const seg = cum[j] - cum[k];
      const t = seg > 0 ? clamp((len - cum[k]) / seg, 0, 1) : 0;
      const mix = (a: number, b: number) => a + (b - a) * t;
      return {
        x: mix(pts[k][0], pts[j][0]),
        y: mix(pts[k][1], pts[j][1]),
        angle: angle[k] + wrap(angle[j] - angle[k]) * t,
        down: mix(down[k], down[j]),
        curvature: mix(curv[k], curv[j]),
      };
    },
  };
}

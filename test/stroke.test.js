// The stroke model: path parsing, resampling and the tip geometry the voice reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStroke, resample, samplePath } from "../dist/index.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test("cubic and quadratic curves are followed to their end points", () => {
  const [pts] = samplePath("M 0 0 C 0 100, 100 100, 100 0");
  assert.deepEqual(pts[0], [0, 0]);
  near(pts.at(-1)[0], 100, 1e-9, "cubic end x");
  near(pts.at(-1)[1], 0, 1e-9, "cubic end y");
  const [q] = samplePath("M 0 0 Q 50 100, 100 0");
  near(Math.max(...q.map((p) => p[1])), 50, 0.5, "quadratic peak");
});

test("relative commands, H/V and Z match their absolute equivalents", () => {
  const abs = createStroke("M 10 10 L 110 10 L 110 60 L 10 60 Z");
  const rel = createStroke("m 10 10 h 100 v 50 H 10 z");
  near(rel.length, abs.length, 1e-9, "length");
  near(abs.length, 300, 1e-9, "closed rectangle perimeter");
  const t = rel.tipAt(150);
  near(t.x, 110, 1e-9, "tip x on the right side");
  near(t.y, 60, 1e-9, "tip y at the corner");
});

test("implicit repeats: extra pairs after M are line-tos", () => {
  near(createStroke("M 0 0 100 0 100 100").length, 200, 1e-9, "M with two extra pairs");
  near(createStroke("M0,0L50,0,50,50").length, 100, 1e-9, "comma-separated L repeat");
});

test("S and T reflect the previous control point", () => {
  const smooth = createStroke("M 0 0 C 0 50, 50 50, 50 0 S 100 -50, 100 0");
  const explicit = createStroke("M 0 0 C 0 50, 50 50, 50 0 C 50 -50, 100 -50, 100 0");
  near(smooth.length, explicit.length, 1e-6, "S = C with the reflected control point");
  const t = createStroke("M 0 0 Q 25 50, 50 0 T 100 0");
  const q = createStroke("M 0 0 Q 25 50, 50 0 Q 75 -50, 100 0");
  near(t.length, q.length, 1e-6, "T = Q with the reflected control point");
});

test("arcs: a half circle of radius 50 is about 157 long, packed flags parse", () => {
  const s = createStroke("M 0 0 A 50 50 0 0 1 100 0");
  near(s.length, Math.PI * 50, 0.5, "half circle length");
  near(Math.min(...s.pts.map((p) => p[1])), -50, 0.5, "sweep=1 goes up (y negative)");
  const packed = createStroke("M0 0a50 50 0 01100 0");
  near(packed.length, s.length, 1e-6, "packed arc flags");
  near(createStroke("M 0 0 A 0 50 0 0 1 100 0").length, 100, 1e-9, "zero radius = straight line");
});

test("a moveto between subpaths adds no length (as SVG's getTotalLength) and lands the pen again", () => {
  const s = createStroke("M 0 0 L 100 0 M 0 50 L 100 50");
  near(s.length, 200, 1e-9, "two 100px subpaths");
  assert.deepEqual(s.starts.map(Math.round), [0, 100]);
  near(s.tipAt(150).y, 50, 1e-9, "second subpath");
  assert.equal(s.turns.length, 0, "the jump between subpaths is not a sharp turn");
});

test("resampling is even and keeps the arc length", () => {
  assert.equal(resample([[0, 0], [100, 0]], 2).length, 51);
  near(createStroke("M 0 0 L 100 0 L 100 60").length, 160, 0.01, "arc length of an L");
});

test("curvature on a circle of radius 50 is about 1/50", () => {
  const r = 50;
  const pts = Array.from({ length: 721 }, (_, k) => {
    const a = (k / 720) * 2 * Math.PI;
    return `${(r * Math.cos(a)).toFixed(3)} ${(r * Math.sin(a)).toFixed(3)}`;
  });
  const s = createStroke(`M ${pts[0]} ${pts.slice(1).map((p) => `L ${p}`).join(" ")}`);
  near(Math.abs(s.tipAt(s.length / 2).curvature), 1 / r, 0.002, "circle curvature");
});

test("direction: down is +1 on a downstroke and -1 on an upstroke (SVG y grows downward)", () => {
  near(createStroke("M 0 0 L 0 200").tipAt(100).down, 1, 1e-6, "downstroke");
  near(createStroke("M 0 200 L 0 0").tipAt(100).down, -1, 1e-6, "upstroke");
});

test("the tip runs from the start to the end and clamps past it", () => {
  const s = createStroke("M 10 20 L 210 20");
  near(s.tipAt(0).x, 10, 1e-9, "start");
  near(s.tipAt(s.length / 2).x, 110, 1e-9, "halfway");
  near(s.tipAt(s.length).x, 210, 1e-9, "end");
  near(s.tipAt(s.length * 2).x, 210, 1e-9, "clamped");
});

test("sharp turns: an arrowhead-style reversal is found, a gentle arc has none", () => {
  const rev = createStroke("M 0 0 L 0 200 L 6 120");
  assert.ok(rev.turns.length >= 1, "reversal not detected");
  near(rev.turns[0], 200, 30, "reversal position");
  assert.equal(createStroke("M 0 0 Q 300 150, 600 0").turns.length, 0);
});

test("bad paths throw a clear error; an empty path is an empty stroke", () => {
  assert.throws(() => createStroke("L 10 10"), /must start with M/);
  assert.throws(() => createStroke("M 0 0 Z 5"), /after Z/);
  assert.equal(createStroke("").length, 0);
  assert.deepEqual(createStroke("").tipAt(5), { x: 0, y: 0, angle: 0, down: 0, curvature: 0 });
});

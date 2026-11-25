// followStroke: which updates make sound, and what the voice is told.
import { test } from "node:test";
import assert from "node:assert/strict";
import { followStroke } from "../dist/index.js";

function fakeVoice() {
  const calls = [];
  return {
    calls,
    voice: {
      move: (m) => calls.push(["move", m]),
      tick: () => calls.push(["tick"]),
      touch: () => calls.push(["touch"]),
    },
  };
}
const clock = () => {
  let t = 1000;
  return { now: () => t, step: (ms) => (t += ms) };
};

test("the first value is silent; only increases sound; decreases and repeats are silent", () => {
  const { calls, voice } = fakeVoice();
  const c = clock();
  const f = followStroke(voice, "M 0 0 L 100 0", { now: c.now });
  f.update(0.5); // first value (e.g. a reload halfway down the page): silent
  assert.equal(calls.length, 0);
  c.step(16);
  f.update(0.6);
  assert.equal(calls.filter((x) => x[0] === "move").length, 1);
  c.step(16);
  f.update(0.6); // no change
  c.step(16);
  f.update(0.3); // scrolling back up
  assert.equal(calls.filter((x) => x[0] === "move").length, 1);
});

test("speed is px per second, with dt capped at 50ms after a pause", () => {
  const { calls, voice } = fakeVoice();
  const c = clock();
  const f = followStroke(voice, "M 0 0 L 100 0", { now: c.now });
  f.update(0);
  c.step(20);
  f.update(0.1); // 10px in 20ms
  assert.equal(Math.round(calls.filter((x) => x[0] === "move").at(-1)[1].speed), 500);
  c.step(5000); // a long pause
  f.update(0.2); // 10px, counted over 50ms, not 5s
  assert.equal(Math.round(calls.filter((x) => x[0] === "move").at(-1)[1].speed), 200);
});

test("the tip's direction and pan position reach the voice", () => {
  const { calls, voice } = fakeVoice();
  const c = clock();
  const f = followStroke(voice, "M 50 0 L 50 100", { now: c.now });
  f.update(0);
  c.step(16);
  f.update(0.5);
  const m = calls.filter((x) => x[0] === "move").at(-1)[1];
  assert.equal(m.x, 50);
  assert.ok(Math.abs(m.down - 1) < 1e-6, "downstroke");
});

test("touch fires once per subpath where the pen lands; ticks fire at sharp turns crossed", () => {
  const { calls, voice } = fakeVoice();
  const c = clock();
  const f = followStroke(voice, "M 0 0 L 0 200 L 6 120 M 50 0 L 150 0", { now: c.now, touchAt: 4 });
  f.update(0);
  for (let p = 0.02; p <= 1.0001; p += 0.02) {
    c.step(16);
    f.update(p);
  }
  assert.equal(calls.filter((x) => x[0] === "touch").length, 2, "one touch per subpath");
  assert.equal(calls.filter((x) => x[0] === "tick").length, f.stroke.turns.length);
  assert.ok(f.stroke.turns.length >= 1);
});

test("a jump over a turn in one update still ticks; reset makes the next update silent", () => {
  const { calls, voice } = fakeVoice();
  const c = clock();
  const f = followStroke(voice, "M 0 0 L 0 200 L 6 120", { now: c.now });
  f.update(0);
  c.step(16);
  f.update(1);
  assert.equal(calls.filter((x) => x[0] === "tick").length, f.stroke.turns.length);
  f.reset();
  const n = calls.length;
  c.step(16);
  f.update(0.5);
  assert.equal(calls.length, n, "silent after reset");
});

test("a lazy forwarder works when the voice is created after the follower", () => {
  const ref = { current: null };
  const lazy = { move: (m) => ref.current?.move(m), tick: () => ref.current?.tick(), touch: () => ref.current?.touch() };
  const c = clock();
  const f = followStroke(lazy, "M 0 0 L 100 0", { now: c.now });
  f.update(0);
  const { calls, voice } = fakeVoice();
  ref.current = voice; // e.g. a React parent's effect, which runs after the child's
  c.step(16);
  f.update(0.5);
  assert.equal(calls.filter((x) => x[0] === "move").length, 1);
});

test("no voice (e.g. reduced motion) is fine", () => {
  const f = followStroke(null, "M 0 0 L 100 0");
  f.update(0);
  f.update(1);
  f.dispose();
});

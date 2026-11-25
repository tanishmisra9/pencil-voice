# Changelog

## 0.1.0

First release.

- `createPencilVoice()`: a synthesized graphite-on-paper scratch in an AudioWorklet, driven by the pen tip's speed,
  direction, curvature and position. It unlocks on the first user gesture and re-arms after iOS interruptions. It's a
  no-op with a warning where AudioWorklet is missing.
- `followStroke()`: follows any SVG path as you push the drawn fraction, voicing new ink only. Its features:
  - a `touch` where each subpath starts and a `tick` at sharp turns;
  - pan read from the element's cached screen transform.
- `createStroke()`: the pure stroke model. It handles the full SVG path grammar (absolute and relative
  `M L H V C S Q T A Z`, implicit repeats, packed arc flags). Movetos add no length, matching SVG's
  `getTotalLength()`.
- The `graphite` preset, fitted to a real pencil recording (no audio shipped).
- `pencil-voice/inline`: the same API with the synth inlined (Blob URL), for setups without a bundler.
- Tools:
  - `tools/fit.mjs` fits the synth to your own recording;
  - `tools/browser-test.mjs` runs an end-to-end check in Chromium.
- A demo page with three ways of drawing (scroll, drag, time) and live knobs.

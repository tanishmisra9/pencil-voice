# pencil-voice

A pencil-on-paper sound that follows any SVG stroke as it's drawn. It's synthesized live from the pen tip's
**speed**, **direction**, **curvature** and **position**:

- a quick flick sounds different from a slow loop;
- a downstroke presses harder than an upstroke;
- tight curves go lighter;
- sharp turns click;
- the sound pans with the tip.

No audio files, no dependencies.

**[Hear it in the demo →](https://tanishmisra9.github.io/pencil-voice/examples/)** Use headphones, and tap once to
allow sound.

```js
import { createPencilVoice, followStroke } from "pencil-voice";

const voice = createPencilVoice();                       // one per page
const pen = followStroke(voice, path.getAttribute("d"), { element: path });

// Wherever your drawing progresses (scroll, pointer, timeline), push the drawn fraction:
path.style.strokeDashoffset = String(1 - progress);      // with pathLength="1" stroke-dasharray="1 1"
pen.update(progress);
```

## Why

Animating a line being drawn is easy ([vivus](https://github.com/maxwellito/vivus),
[rough-notation](https://github.com/rough-stuff/rough-notation), a `stroke-dashoffset`). Making it *sound* drawn usually
means looping a recording, which plays the same whether the pen crawls or flies, turns or goes straight.
pencil-voice models the tip instead, so the sound comes from the stroke you actually drew.

## Install

From GitHub, pinned to a release:

```sh
npm install github:tanishmisra9/pencil-voice#v0.1.0
```

The package ships built (`dist/`), so the install runs no build step. ESM only, with TypeScript types.

## Quick start

1. **Create one voice per page.** It owns one AudioContext and one synth, and every stroke can share it:

   ```js
   const voice = createPencilVoice();
   ```

2. **Follow each stroke** with its path data. Pass the element too, so the sound can pan with the tip:

   ```js
   const pen = followStroke(voice, pathEl.getAttribute("d"), { element: pathEl });
   ```

3. **Push progress (0…1) whenever the drawing moves.** pencil-voice never listens to scroll and never runs its own
   animation loop. You call it from whatever already drives the drawing:

   ```js
   pen.update(progress);
   ```

4. **Clean up** when the stroke or page goes away:

   ```js
   pen.dispose();
   voice.dispose();
   ```

Only increases make sound. Going backwards, repeating a value, or the very first value (say, a page reloaded halfway
down) is silent, so un-drawing never scratches.

## Recipes

### Vanilla: drawn by scroll

```html
<svg viewBox="0 0 500 400"><path id="p" d="M 40 40 C 300 0, 400 200, 250 300" pathLength="1"
  style="fill:none;stroke:#222;stroke-width:3;stroke-linecap:round;stroke-dasharray:1 1;stroke-dashoffset:1" /></svg>
```

```js
import { createPencilVoice, followStroke } from "pencil-voice";

const path = document.getElementById("p");
const voice = createPencilVoice();
const pen = followStroke(voice, path.getAttribute("d"), { element: path });
const section = path.closest("section");

addEventListener("scroll", () => {
  const r = section.getBoundingClientRect();
  const p = Math.min(1, Math.max(0, -r.top / (r.height - innerHeight)));
  path.style.strokeDashoffset = String(1 - p);
  pen.update(p);
}, { passive: true });
```

### React + Framer Motion

```tsx
import { useEffect, useRef } from "react";
import { motion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { createPencilVoice, followStroke, type PencilVoice } from "pencil-voice";

// One voice for the page. Skip it for reduced motion.
function usePencilVoice() {
  const voice = useRef<PencilVoice | null>(null);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    voice.current = createPencilVoice();
    return () => voice.current?.dispose();
  }, []);
  return voice;
}

function Stroke({ d, draw, voice }: { d: string; draw: MotionValue<number>; voice: React.RefObject<PencilVoice | null> }) {
  const ref = useRef<SVGPathElement>(null);
  useEffect(() => {
    const pen = followStroke(voice.current, d, { element: ref.current });
    pen.update(draw.get());
    const off = draw.on("change", pen.update);
    return () => { off(); pen.dispose(); };
  }, [d, draw, voice]);
  return <motion.path ref={ref} d={d} style={{ pathLength: draw }} fill="none" stroke="currentColor" />;
}

// const { scrollYProgress } = useScroll({ target }); const draw = useTransform(scrollYProgress, [0.2, 0.8], [0, 1]);
```

### GSAP ScrollTrigger

```js
const pen = followStroke(voice, path.getAttribute("d"), { element: path });
gsap.to(path, {
  strokeDashoffset: 0,
  scrollTrigger: { trigger: path, start: "top 80%", end: "bottom 20%", scrub: true, onUpdate: (st) => pen.update(st.progress) },
});
```

### Drawn by a pointer, or over time

Anything that produces a 0…1 number works. The demo drives one stroke from an `<input type="range">` and another from
`requestAnimationFrame` with an easing curve. To replay a stroke from the start, call `pen.reset()` (or make a new
follower) so the restart at 0 is silent.

## API

### `createPencilVoice(options?) → PencilVoice`

| Option | Default | |
|---|---|---|
| `config` | | Any subset of the [tuning knobs](docs/tuning.md), layered over the preset. |
| `preset` | `graphite` | The base sound. |
| `audioContext` | a new one | Share an existing context. `dispose()` won't close one you passed in. |
| `processorUrl` | next to the module | Where to load the synth (`pencil-processor.js`) from. See [Bundlers](#bundlers-and-the-worklet-file). |
| `unlockEvents` | `pointerdown keydown touchend` | Gestures that are allowed to start audio. |
| `onWarn` | `console.warn` | Called when the voice can't make sound (no Web Audio, no AudioWorklet, worklet failed to load). |

The returned voice has:

| Member | |
|---|---|
| `move({ x, viewport, speed, down, curvature })` | The tip moved. `followStroke` calls this for you. |
| `tick()` / `touch()` | Transients: a sharp turn, and the pen landing. |
| `configure(partialConfig)` | Change knobs live. |
| `config` | The live config. |
| `context` | The AudioContext, or `null` when the voice is a no-op. |
| `ready` | A promise that resolves `true` once the synth has loaded, or `false` if it never will. |
| `dispose()` | Stop and release everything. |

Where audio can't work (server rendering, no Web Audio, no AudioWorklet), `createPencilVoice` returns a no-op voice
with the same shape, so your code doesn't need to branch.

### `followStroke(voice, d, options?) → StrokeFollower`

| Option | Default | |
|---|---|---|
| `element` | | The `<path>` (or its `<svg>`). Its screen transform maps the tip to viewport x for panning, and is read once and again on window resize. Without it, the path's x is used as viewport px. |
| `sampleStep` | 2 | px between the model's points. |
| `tickTurn`, `tickSpan` | 100, 28 | A sharp turn is a heading change above `tickTurn`° within `tickSpan` px. |
| `touchAt` | 4 | px into each subpath where the pen "lands". |
| `now` | `performance.now` | The clock (handy in tests). |

The returned follower has `update(progress)`, `reset()`, `dispose()` and `stroke` (the model). `voice` may be `null`;
the follower then does nothing, which is handy for reduced motion.

### `createStroke(d, options?) → Stroke`

The pure stroke model, if you want the geometry for something else: `length`, `turns`, `starts`, and `tipAt(len)` →
`{ x, y, angle, down, curvature }`. It reads the full SVG path grammar (absolute and relative `M L H V C S Q T A Z`,
implicit repeats, packed arc flags). A moveto adds no length, the same as `getTotalLength()`.

### Lower level

`loadPencilProcessor(ctx, url?)` and `createPencilNode(ctx, config)` give you the raw synth node, e.g. to render
offline in an `OfflineAudioContext` or to route it through your own effects. `graphite` is the default preset object.

## Browser notes

- **Silent until the first gesture.** Browsers don't start audio until the user clicks, taps or presses a key, and
  scrolling never counts. The voice unlocks itself on the first gesture. Strokes drawn before then are silent. If the
  sound matters, give people something to click.
- **Needs https (or localhost).** AudioWorklet only exists in a secure context. A phone opening your dev server at
  `http://192.168.x.x:3000` gets no worklet, so it's silent, with a console warning. Use an https tunnel to test on a
  phone.
- **iPhone silent switch.** iOS mutes Web Audio when the Ring/Silent switch is on silent. Plain `<audio>` elements play
  anyway, which can make it look as if only this library is broken.
- **iOS interruptions.** A call or an app switch suspends audio. The voice re-arms and resumes on the next tap.
- **Reduced motion.** If the drawing itself doesn't animate for `prefers-reduced-motion`, don't create a voice. Pass
  `null` to `followStroke` instead.
- **Very fast flicks.** If one update draws a short stroke from start to end, it gets one short burst of sound. That's
  usually what you want; a stroke that sounds for longer needs more updates (scrub smoothing helps).

## Bundlers and the worklet file

The synth has to be loaded as its own file by `audioWorklet.addModule()`. By default pencil-voice asks for
`new URL("./pencil-processor.js", import.meta.url)`, which webpack 5, Next.js, Vite, Rollup and esbuild recognise.
They copy the file into your build as a separate, content-hashed asset. It downloads once, is cached, and never sits in
your JS bundle.

If your setup doesn't resolve it:

- **Host it yourself.** Copy `node_modules/pencil-voice/dist/pencil-processor.js` into your public folder and pass
  `createPencilVoice({ processorUrl: "/pencil-processor.js" })`.
- **Or inline it.** Import from `pencil-voice/inline`, the same API with the synth embedded and loaded from a Blob URL.
  It costs a few KB in your bundle that aren't cached separately, and a strict Content-Security-Policy must allow
  `blob:` for workers/scripts.

## Performance

- **Main thread:** `update()` is a binary search over the stroke's points plus a few `AudioParam` updates. Nothing
  reads layout per call: the element's transform is cached and re-read only on resize. There's no scroll listener and
  no animation loop inside the library.
- **Audio thread:** the synth runs in an AudioWorklet, so a janky main thread doesn't glitch it, and it doesn't slow
  scrolling. When nothing is drawing it writes silence without running any filter.
- **One voice per page.** Every stroke should share it: each voice is a separate AudioContext and synth.
- **Size:** about 23 KB of JS before minifying (about 8 KB gzipped, with all comments), plus the 6 KB worklet file
  (2 KB gzipped). No dependencies.

## How it works and tuning

- [docs/how-it-works.md](docs/how-it-works.md): the stroke model, the mapping from tip to sound, and the synth's signal
  chain.
- [docs/tuning.md](docs/tuning.md): every knob, what you'll hear, and how to fit the synth to a recording of your own
  pencil.

## Development

```sh
npm install
npm test                         # builds, then runs the stroke-model and follower tests (node --test)
npx playwright install chromium
npm run test:browser             # drives the demo in headless Chromium and checks the synth is actually played
```

`dist/` is committed so GitHub installs need no build; CI checks it matches `src/`.

## Provenance and licence

The `graphite` preset's band gains were fitted to a recording of a real pencil. Only the resulting numbers are
included, never the recording. Code: [MIT](LICENSE).

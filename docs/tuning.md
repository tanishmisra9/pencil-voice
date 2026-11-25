# Tuning

Every knob is in the `PencilConfig`. Pass any subset when you create the voice, or change knobs live:

```js
const voice = createPencilVoice({ config: { max: 0.3, pan: 0 } });
voice.configure({ brightness: 0.6 }); // live, e.g. from a settings slider
```

The defaults are the `graphite` preset: a soft pencil on drawing paper.

## Loudness and feel

| Knob | Default | Unit | What you hear |
|---|---|---|---|
| `floor` | 0.085 | linear level | How loud any movement is, however slow. Raise it if slow strokes vanish. |
| `max` | 0.23 | linear level | How loud a fast stroke gets. Move `floor` and `max` together to change the overall volume. |
| `fullSpeed` | 900 | px/s | The speed at which the level reaches `max`. Lower it and moderate strokes get louder sooner. |
| `downWeight` | 0.15 | × | Extra pressure on downstrokes (and less on upstrokes). 0 = direction doesn't change the level. |
| `curvatureSoft` | 0.35 | × | How much lighter the pencil gets through tight curves. 0 = no change. |
| `curvatureScale` | 30 | px | What counts as tight: the higher it is, the gentler a curve has to be to stay at full level. |
| `brightness` | 0.35 | octaves | How far the tone shifts with direction: upstrokes thinner and brighter, downstrokes fuller. 0 = no shift. |
| `pan` | 0.6 | 0…1 | Stereo width: how far the sound follows the tip left and right. 0 = mono. |

## Timing

| Knob | Default | Unit | What you hear |
|---|---|---|---|
| `attack` | 0.012 | s | How fast the sound bites when the pen starts moving. |
| `release` | 0.04 | s | How fast it fades once the pen stops. |
| `releaseAfterMs` | 80 | ms | How long without movement before it fades. Too short and continuous scrolling flutters; too long and a tiny scroll rings on. |

## Paper

| Knob | Default | Unit | What you hear |
|---|---|---|---|
| `tooth` | 0.5 | × bed | How loud the paper's grain crackles. 0 = a smooth pen on glass. |
| `toothPerPx` | 0.6 | clicks/px | How dense the crackle is per distance drawn. Rougher paper = higher. |
| `toothFreq` | 3400 | Hz | Pitch of the crackle. Lower sounds like heavier paper. |
| `toothDecay` | 0.0025 | s | Length of each click. Longer sounds scratchier. |

## Events

| Knob | Default | Unit | What you hear |
|---|---|---|---|
| `tick` | 0.5 | level | The click at a sharp turn (an arrowhead tip, a hairpin). 0 = none. |
| `touch` | 0.35 | level | The tap where the pen lands at the start of each subpath. 0 = none. |

What counts as a sharp turn is set per stroke, in `followStroke(voice, d, { tickTurn, tickSpan })`. The defaults are a
heading change of more than 100° within 28 px of travel. `touchAt` (default 4 px) is how far into a subpath the touch
fires.

## Timbre (the friction bed)

| Knob | Default | What it is |
|---|---|---|
| `bands` | 20 bands, 125 Hz–10 kHz | `{ f, q, g }`: the centre (Hz), resonance and linear gain of each band. This is the pencil's tone. |
| `hp` | 100 | Hz. A high-pass under everything, to cut rumble. 0 = off. |
| `outGain` | 0.3655 | Output scale at full pressure. The fit tool sets it so the synth matches the recording's level. |

Hand-editing `bands` works for broad strokes; boosting a few bands around 500 Hz–1 kHz makes it woodier. To make it
sound like a particular pencil, fit it.

## Fit the sound to your own recording

1. Record a few seconds of steady drawing: no pauses, no taps, as little room noise as you can manage. Any format
   Chromium decodes works (wav, mp3, ogg, m4a).
2. In this repo:

   ```sh
   npm install
   npx playwright install chromium
   npm run build
   node tools/fit.mjs path/to/my-pencil.wav
   ```

3. It prints the error for every band on each pass, then a JSON preset with your `bands` and `outGain`:

   ```js
   import myPencil from "./my-pencil.json" with { type: "json" };
   const voice = createPencilVoice({ config: myPencil });
   ```

The fit matches the spectrum (the colour of the noise) and the overall level at a steady speed. The dynamics (how the
sound reacts to speed, direction and turns) still come from the knobs above, so tune those by ear afterwards. To start
from a different set of bands, save a preset as JSON and pass `--from preset.json`.

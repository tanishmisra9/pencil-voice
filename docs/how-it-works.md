# How it works

pencil-voice has three layers. Each one only talks to the next:

```
your drawing (scroll, pointer, timeline …)
        │  progress 0…1, pushed whenever it changes
        ▼
followStroke ── stroke model (createStroke): where is the tip, where is it heading, how tight is the turn?
        │  move({ x, viewport, speed, down, curvature }), tick(), touch()
        ▼
voice (createPencilVoice) ── maps the tip to synth parameters, unlocks audio, smooths everything
        │  AudioParams: pressure, brightness, toothRate · messages: burst
        ▼
synth (AudioWorklet "pencil-voice") ── friction bed + paper tooth + transients → StereoPanner → speakers
```

## 1. The stroke model (`createStroke`)

The path `d` is parsed with the full SVG grammar: `M L H V C S Q T A Z`, absolute and relative, with implicit repeats,
reflected control points for `S`/`T`, and arcs converted to centre form. Curves and arcs are flattened about every 1.5
units, then resampled to evenly spaced points `sampleStep` apart (2 by default).

At each point the model knows:

| Value | How | Meaning |
|---|---|---|
| arc length | running sum | how far along the stroke this point is |
| heading | centred difference of neighbours | which way the pen is moving |
| `down` | `sin(heading)` | +1 straight down, −1 straight up (SVG y grows downward) |
| curvature | heading change over ±2 points ÷ the distance between them | 1/px; large in tight loops |
| sharp turns | total heading change above `tickTurn`° within `tickSpan` px | arrowhead tips, hairpins |
| pen landings | the start of each subpath | where a new line begins |

A moveto between subpaths adds no length, the same as SVG's `getTotalLength()`. So the same 0…1 progress that drives a
`stroke-dashoffset` animation lines up with the model. `tipAt(len)` does a binary search over the arc lengths and
interpolates; it's the only per-frame work.

## 2. Following a stroke (`followStroke`)

Each `update(progress)`:

1. converts progress to a length and reads the tip there;
2. if the length grew since the last update, computes the speed in px/s. The time between updates is capped at 50 ms,
   so the first movement after a pause isn't divided by the whole pause;
3. calls `voice.move` with the tip's viewport x, the speed, `down` and the curvature;
4. calls `voice.touch()` when the drawn length passes `touchAt` px into a subpath (the pen lands), and `voice.tick()`
   for every sharp turn crossed since the last update. A fast update that jumps over a turn still ticks.

The first value is silent. That covers a reload halfway down a page, and a stroke that was already drawn when it
mounted. Going backwards is silent too: only new ink makes sound.

To place the tip on screen, the follower reads the element's screen transform (`getScreenCTM`) once and again on window
resize. Reading it on every update would force a layout on every frame. Vertical scrolling doesn't move a stroke
sideways, so the cached x stays right.

## 3. The voice (`createPencilVoice`)

`move()` turns one tip reading into synth parameters:

```
tightness  = 1 − 1 / (1 + curvatureScale · |curvature|)                      0 on a straight run … →1 in a tight loop
level      = (floor + (max − floor) · min(speed / fullSpeed, 1))
             · (1 + downWeight · down)                                         downstrokes press harder
             · (1 − curvatureSoft · tightness)                                 tight curves are lighter
brightness = −down · brightness                                                upstrokes brighter, downstrokes darker
toothRate  = speed · toothPerPx                                                clicks per second ∝ px per second
pan        = clamp(pan · (2 · x / viewport − 1), −1, 1)
```

Each value is applied with `setTargetAtTime`, so it glides instead of stepping (`attack` for the level). After
`releaseAfterMs` with no `move`, the level and the tooth fall to zero with time constant `release`. Scroll and pointer
events arrive every frame while something moves, so the default 80 ms bridges them and a tiny scroll doesn't ring on.

**Audio unlock.** Browsers keep a new AudioContext suspended until a user gesture, and scrolling never counts. The voice
listens (capture phase) for `pointerdown`, `keydown` and `touchend` and resumes on the first one. iOS can interrupt a
running context (a call, an app switch), so the voice listens again whenever the state leaves `running`.

## 4. The synth (AudioWorklet)

All of it runs on the audio thread, so a busy main thread doesn't make it stutter.

**Friction bed.** 20 resonant bands at one-third-octave centres from 125 Hz to 10 kHz. Each band has:
- its own xorshift white-noise generator, so band powers add instead of interfering;
- two cascaded TPT state-variable band-passes (4th order), so a loud band doesn't leak into a quiet neighbour.

The bands are summed and passed through a 4th-order high-pass at `hp` Hz to remove rumble. `brightness` shifts every
centre frequency by 2^brightness. That's how upstrokes get thinner and downstrokes fuller.

**Paper tooth.** Each sample, a click starts with probability `toothRate / sampleRate`. A click is a short noise burst
(decay `toothDecay`) through a band at `toothFreq`. The click rate follows the distance drawn, so a fast stroke
crackles more densely, and the crackle stops the moment the tip does.

**Transients.** A `burst` message (from `tick` or `touch`) sets off a short noise burst (8 ms decay) through a band
near 2.2 kHz.

**Output.** `(pressure · (bed + 3 · tooth · click) + burst) · outGain`, mono, into a StereoPanner. When the pressure,
the tooth envelope and the burst are all near zero, the processor writes silence without running any filter, so an idle
voice costs almost nothing.

## Fitting

The `graphite` band gains were fitted to a recording of a real pencil by `tools/fit.mjs`:
1. render the synth offline at a steady mid speed;
2. measure both the render and the recording in one-third-octave bands;
3. nudge each band's gain by its error (at most ±6 dB per step);
4. repeat until every band is within ±1.5 dB, then match the overall level.

See [tuning.md](tuning.md) to fit your own.

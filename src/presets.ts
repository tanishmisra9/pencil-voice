// Every knob of the sound, with units. `graphite` is the default: a soft pencil on drawing paper.

/** One resonant band of the friction bed: centre (Hz), Q, linear gain. */
export type Band = { f: number; q: number; g: number };

export type PencilConfig = {
  /**
   * The friction bed: a graphic EQ of resonant bands, each fed its own independent noise so band powers add instead of
   * interfering. Each band is two cascaded band-passes (4th order) so a loud band doesn't leak into a quiet neighbour.
   */
  bands: Band[];
  /** Hz. A 4th-order high-pass under the bed, to remove rumble below the lowest band. 0 = off. */
  hp: number;
  /** Output scale at pressure 1. */
  outGain: number;

  /** Level (linear) for any movement at all, so even a slow tip is audible. */
  floor: number;
  /** Level (linear) at `fullSpeed` and above. */
  max: number;
  /** px/s of tip travel at which the level reaches `max`. */
  fullSpeed: number;
  /** Level × (1 + downWeight × down): a downstroke presses harder, an upstroke lighter. */
  downWeight: number;
  /** Level × (1 − curvatureSoft × tightness) through tight curves (tightness 0 straight … →1 tight). */
  curvatureSoft: number;
  /** px. tightness = 1 − 1 / (1 + curvatureScale × |curvature|). */
  curvatureScale: number;
  /** Octaves the band bank shifts with direction: up on upstrokes (lighter, thinner), down on downstrokes (fuller). */
  brightness: number;

  /** Paper tooth: random clicks per px of tip travel, so the crackle is locked to the distance drawn. */
  toothPerPx: number;
  /** Paper tooth level relative to the friction bed. */
  tooth: number;
  /** Hz. Centre of the tooth clicks. */
  toothFreq: number;
  /** s. Decay of each tooth click. */
  toothDecay: number;

  /** Stereo width: pan = pan × the tip's position across the viewport (−1 left … 1 right). 0 = mono. */
  pan: number;
  /** s. Time constant of the level rising when the pen moves (how fast it bites). */
  attack: number;
  /** s. Time constant of the level falling once the tip stops. */
  release: number;
  /**
   * ms with no movement before the level releases. Scroll and pointer events arrive every frame while something moves,
   * so 80ms bridges them, yet a tiny scroll doesn't ring on.
   */
  releaseAfterMs: number;
  /** Transient level where the pen turns sharply (arrowhead tips, tight loops). */
  tick: number;
  /** Transient level where the pen lands. */
  touch: number;
};

/**
 * A soft graphite pencil on drawing paper. The 20 one-third-octave band gains (125 Hz–10 kHz) and `outGain` were fitted
 * to a recording of a real pencil with `tools/fit.mjs`: every band within ±1.5 dB of the recording (3.15 kHz wanders to
 * about ±1.8 dB run to run, because the random paper-tooth clicks live there), level ratio 1.004. No audio is shipped,
 * only these measurements. The near-zero 3150/4000 Hz gains are right: the paper tooth fills them.
 */
export const graphite: PencilConfig = {
  bands: [
    { f: 125, q: 4.3, g: 0.2642 },
    { f: 160, q: 4.3, g: 0.2508 },
    { f: 200, q: 4.3, g: 0.259 },
    { f: 250, q: 4.3, g: 0.3536 },
    { f: 315, q: 4.3, g: 0.3415 },
    { f: 400, q: 4.3, g: 0.8402 },
    { f: 500, q: 4.3, g: 2.9578 },
    { f: 630, q: 4.3, g: 1.7818 },
    { f: 800, q: 4.3, g: 1.2744 },
    { f: 1000, q: 4.3, g: 0.7346 },
    { f: 1250, q: 4.3, g: 0.4433 },
    { f: 1600, q: 4.3, g: 0.7825 },
    { f: 2000, q: 4.3, g: 0.1139 },
    { f: 2500, q: 4.3, g: 0.3271 },
    { f: 3150, q: 4.3, g: 0.0027 },
    { f: 4000, q: 4.3, g: 0.0113 },
    { f: 5000, q: 4.3, g: 0.1507 },
    { f: 6300, q: 4.3, g: 0.3565 },
    { f: 8000, q: 4.3, g: 0.4593 },
    { f: 10000, q: 4.3, g: 0.8227 },
  ],
  hp: 100,
  outGain: 0.3655,
  floor: 0.085,
  max: 0.23,
  fullSpeed: 900,
  downWeight: 0.15,
  curvatureSoft: 0.35,
  curvatureScale: 30,
  brightness: 0.35,
  toothPerPx: 0.6,
  tooth: 0.5,
  toothFreq: 3400,
  toothDecay: 0.0025,
  pan: 0.6,
  attack: 0.012,
  release: 0.04,
  releaseAfterMs: 80,
  tick: 0.5,
  touch: 0.35,
};

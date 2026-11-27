// pencil-voice synth (AudioWorkletProcessor "pencil-voice"). A fully synthesized graphite-on-paper scratch; the voice
// (voice.ts) drives it from the pen tip's motion. Every timbre constant arrives in processorOptions (see presets.ts).
//
//  friction bed   independent white noise per band → cascaded resonant band-passes (centres/Qs/gains from the preset),
//                 summed, then a 4th-order high-pass; the whole bank shifts up/down by `brightness` octaves
//  paper tooth    sparse clicks at `toothRate` per second (the voice sets it from px travelled, so the crackle is
//                 locked to drawn distance), each a short decaying noise burst through its own band
//  transients     "burst" messages: a tick at sharp turns, a touch where the pen lands
//  level          `pressure` (smoothed by the voice with setTargetAtTime)
//
// Plain JavaScript on purpose: it is loaded as-is by audioWorklet.addModule(), with no bundler involved.

class PencilVoiceProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "pressure", defaultValue: 0, minValue: 0, maxValue: 4, automationRate: "k-rate" },
      { name: "brightness", defaultValue: 0, minValue: -3, maxValue: 3, automationRate: "k-rate" },
      { name: "toothRate", defaultValue: 0, minValue: 0, maxValue: 40000, automationRate: "k-rate" },
    ];
  }

  constructor(options) {
    super();
    const o = options.processorOptions;
    this.bands = PencilVoiceProcessor.makeBands(o.bands);
    this.hp = o.hp ?? 0;
    this.hpA = { s1: 0, s2: 0 };
    this.hpB = { s1: 0, s2: 0 };
    this.outGain = o.outGain;
    this.toothLevel = o.tooth;
    this.toothFreq = o.toothFreq;
    this.toothDecay = Math.exp(-1 / (o.toothDecay * sampleRate));
    this.burstDecay = Math.exp(-1 / (0.008 * sampleRate));
    this.tooth = { s1: 0, s2: 0, env: 0 };
    this.burstSvf = { s1: 0, s2: 0 };
    // Filter coefficients, refilled in place every block: no allocation on the audio thread (GC there clicks).
    this.hpC = PencilVoiceProcessor.newCoef();
    this.toothC = PencilVoiceProcessor.newCoef();
    this.burstC = PencilVoiceProcessor.newCoef();
    this.burst = 0;
    this.seed = 0x2545f491;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (!m) return;
      if (m.type === "burst") this.burst = Math.max(this.burst, m.amp);
      if (m.type === "config") {
        // Live retuning: any subset of the processor-side knobs (the fitting tool and the demo's sliders use it).
        if (Array.isArray(m.bands)) this.bands = PencilVoiceProcessor.makeBands(m.bands, this.bands);
        if (typeof m.outGain === "number") this.outGain = m.outGain;
        if (typeof m.hp === "number") this.hp = m.hp;
        if (typeof m.tooth === "number") this.toothLevel = m.tooth;
        if (typeof m.toothFreq === "number") this.toothFreq = m.toothFreq;
        if (typeof m.toothDecay === "number") this.toothDecay = Math.exp(-1 / (m.toothDecay * sampleRate));
      }
    };
  }

  // Each band has its own noise generator (seeded apart), so band powers add instead of interfering.
  static makeBands(bands, prev = []) {
    return bands.map((b, i) => ({
      f: b.f,
      q: b.q,
      g: b.g,
      s1: prev[i]?.s1 ?? 0,
      s2: prev[i]?.s2 ?? 0,
      t: prev[i]?.t ?? { s1: 0, s2: 0 },
      seed: prev[i]?.seed ?? ((0x9e3779b9 * (i + 1)) >>> 0 || 1),
      c: PencilVoiceProcessor.newCoef(),
    }));
  }

  // xorshift32 white noise in [-1, 1); `st` holds its own seed (the processor, or one band).
  noise(st = this) {
    let x = st.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    st.seed = x >>> 0;
    return st.seed / 2147483648 - 1;
  }

  static newCoef() {
    return { a1: 0, a2: 0, a3: 0, k: 0 };
  }

  // Coefficients of a TPT state-variable filter (Simper), written into `c`; the band-pass output is normalised to
  // unity peak.
  static coef(f, q, c) {
    const g = Math.tan((Math.PI * Math.min(f, sampleRate * 0.45)) / sampleRate);
    c.k = 1 / q;
    c.a1 = 1 / (1 + g * (g + c.k));
    c.a2 = g * c.a1;
    c.a3 = g * g * c.a1;
    return c;
  }

  static bp(st, c, x) {
    const v3 = x - st.s2;
    const v1 = c.a1 * st.s1 + c.a2 * v3;
    const v2 = st.s2 + c.a2 * st.s1 + c.a3 * v3;
    st.s1 = 2 * v1 - st.s1;
    st.s2 = 2 * v2 - st.s2;
    return v1 * c.k;
  }

  static hpf(st, c, x) {
    const v3 = x - st.s2;
    const v1 = c.a1 * st.s1 + c.a2 * v3;
    const v2 = st.s2 + c.a2 * st.s1 + c.a3 * v3;
    st.s1 = 2 * v1 - st.s1;
    st.s2 = 2 * v2 - st.s2;
    return x - c.k * v1 - v2;
  }

  process(_inputs, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;
    const pressure = params.pressure[0];
    // Silent fast path: nothing pressing, no transient ringing → write zeros without running any filter.
    if (pressure < 1e-5 && this.burst < 1e-5 && this.tooth.env < 1e-5) {
      out.fill(0);
      return true;
    }
    const shift = Math.pow(2, params.brightness[0]);
    const pClick = params.toothRate[0] / sampleRate;
    const C = PencilVoiceProcessor;
    for (let b = 0; b < this.bands.length; b++) C.coef(this.bands[b].f * shift, this.bands[b].q, this.bands[b].c);
    const hpC = this.hp > 0 ? C.coef(this.hp * shift, Math.SQRT1_2, this.hpC) : null;
    const toothC = C.coef(this.toothFreq * shift, 1.6, this.toothC);
    const burstC = C.coef(2200 * shift, 0.9, this.burstC);
    for (let i = 0; i < out.length; i++) {
      const w = this.noise();
      let bed = 0;
      for (let b = 0; b < this.bands.length; b++) {
        const band = this.bands[b];
        bed += band.g * C.bp(band.t, band.c, C.bp(band, band.c, this.noise(band)));
      }
      if (hpC) bed = C.hpf(this.hpB, hpC, C.hpf(this.hpA, hpC, bed));
      if (pClick > 0 && Math.random() < pClick) this.tooth.env = Math.max(this.tooth.env, 0.6 + 0.4 * Math.random());
      const click = C.bp(this.tooth, toothC, w * this.tooth.env);
      this.tooth.env *= this.toothDecay;
      const burst = this.burst > 1e-5 ? C.bp(this.burstSvf, burstC, this.noise() * this.burst) : 0;
      this.burst *= this.burstDecay;
      out[i] = (pressure * (bed + this.toothLevel * 3 * click) + burst) * this.outGain;
    }
    return true;
  }
}

registerProcessor("pencil-voice", PencilVoiceProcessor);

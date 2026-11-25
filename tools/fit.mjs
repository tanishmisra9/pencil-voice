// Fit the synth to your own recording. Renders the synth offline in headless Chromium (4 s at a steady drawing
// speed), compares 1/3-octave band levels from 125 Hz to 10 kHz (spectral shape, level-normalised) against the
// recording, nudges the band gains until every band is within ±1.5 dB, matches the output level, and prints a preset.
//
//   npm run build
//   node tools/fit.mjs path/to/pencil-recording.wav            (any format Chromium decodes: wav, mp3, ogg, m4a…)
//   node tools/fit.mjs rec.wav --from preset.json              (start from your own preset instead of graphite)
//
// The recording should be a steady stretch of drawing (no silence, no taps), a few seconds long, mono or stereo.
// Needs Playwright's Chromium (`npx playwright install chromium`), or CHROME=/path/to/chrome.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { graphite } from "../dist/index.js";

const args = process.argv.slice(2);
const recording = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--from");
if (!recording) {
  console.error("usage: node tools/fit.mjs <recording> [--from preset.json]");
  process.exit(1);
}
const from = args.includes("--from") ? JSON.parse(readFileSync(args[args.indexOf("--from") + 1], "utf8")) : graphite;
const preset = structuredClone({ ...graphite, ...from });
const processor = readFileSync(fileURLToPath(new URL("../dist/pencil-processor.js", import.meta.url)), "utf8");
const audio = readFileSync(recording);

const CENTRES = [125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000];
const ORIGIN = "https://fit.pencil-voice.test"; // intercepted below: a secure origin, so AudioWorklet exists

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage();
await page.route(`${ORIGIN}/**`, (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === "/recording") return route.fulfill({ contentType: "application/octet-stream", body: audio });
  return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>fit</title>" });
});
await page.goto(`${ORIGIN}/`);

const measure = (p) =>
  page.evaluate(async ({ p, CENTRES, processor }) => {
    const SR = 44100;
    const analyse = (x) => {
      const N = 8192;
      const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
      const power = new Float64Array(N / 2);
      let frames = 0;
      for (let off = 0; off + N <= x.length; off += N / 2, frames++) {
        const re = new Float64Array(N);
        const im = new Float64Array(N);
        for (let i = 0; i < N; i++) re[i] = x[off + i] * win[i];
        for (let i = 1, j = 0; i < N; i++) {
          let bit = N >> 1;
          for (; j & bit; bit >>= 1) j ^= bit;
          j ^= bit;
          if (i < j) [re[i], re[j], im[i], im[j]] = [re[j], re[i], im[j], im[i]];
        }
        for (let len = 2; len <= N; len <<= 1) {
          const a = (-2 * Math.PI) / len;
          for (let i = 0; i < N; i += len)
            for (let k = 0; k < len / 2; k++) {
              const [c, s] = [Math.cos(a * k), Math.sin(a * k)];
              const [ur, ui] = [re[i + k], im[i + k]];
              const vr = re[i + k + len / 2] * c - im[i + k + len / 2] * s;
              const vi = re[i + k + len / 2] * s + im[i + k + len / 2] * c;
              re[i + k] = ur + vr;
              im[i + k] = ui + vi;
              re[i + k + len / 2] = ur - vr;
              im[i + k + len / 2] = ui - vi;
            }
        }
        for (let k = 0; k < N / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
      }
      const band = CENTRES.map((fc) => {
        const [lo, hi] = [fc / 2 ** (1 / 6), fc * 2 ** (1 / 6)];
        let e = 0;
        for (let k = Math.ceil((lo * N) / SR); k <= Math.floor((hi * N) / SR); k++) e += power[k];
        return e / frames;
      });
      const total = band.reduce((a, b) => a + b, 0);
      const rms = Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
      return { shape: band.map((e) => 10 * Math.log10(e / total)), rms };
    };
    const buf = await (await fetch("/recording")).arrayBuffer();
    const decoded = await new OfflineAudioContext(1, SR, SR).decodeAudioData(buf);
    const ref = decoded.getChannelData(0);
    const ctx = new OfflineAudioContext(1, SR * 4, SR);
    // Worklet fetches can't be intercepted by Playwright, so the synth is loaded from a Blob URL here.
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([processor], { type: "text/javascript" })));
    const keys = ["bands", "hp", "outGain", "tooth", "toothFreq", "toothDecay"];
    const node = new AudioWorkletNode(ctx, "pencil-voice", {
      numberOfInputs: 0,
      outputChannelCount: [1],
      processorOptions: Object.fromEntries(keys.map((k) => [k, p[k]])),
    });
    node.parameters.get("pressure").setValueAtTime(1, 0);
    node.parameters.get("toothRate").setValueAtTime((p.fullSpeed / 2) * p.toothPerPx, 0); // a steady mid speed
    node.connect(ctx.destination);
    const syn = (await ctx.startRendering()).getChannelData(0).slice(SR / 2); // skip the filters settling
    return { ref: analyse(ref), syn: analyse(syn) };
  }, { p, CENTRES, processor });

// Each 1/3-octave band is corrected through the synth band nearest to it (log frequency).
const nearest = CENTRES.map((fc) =>
  preset.bands.reduce((best, b, i) => (Math.abs(Math.log2(b.f / fc)) < Math.abs(Math.log2(preset.bands[best].f / fc)) ? i : best), 0),
);
let r;
for (let it = 0; it < 30; it++) {
  r = await measure(preset);
  const err = r.syn.shape.map((v, i) => v - r.ref.shape[i]);
  const worst = Math.max(...err.map(Math.abs));
  const ratio = r.syn.rms / r.ref.rms;
  console.log(`iter ${String(it).padStart(2)}  worst band error ${worst.toFixed(2)} dB  level ratio ${ratio.toFixed(3)}`);
  preset.outGain = +(preset.outGain / ratio).toFixed(4);
  if (worst <= 1.5 && Math.abs(ratio - 1) < 0.03) break;
  preset.bands = preset.bands.map((b, i) => {
    const mine = err.filter((_, k) => nearest[k] === i);
    const e = mine.length ? mine.reduce((a, v) => a + v, 0) / mine.length : 0;
    // Clamped step (±6 dB per iteration) and range, so one noisy reading can't run a band away.
    const step = Math.max(-6, Math.min(6, -0.8 * e));
    return { ...b, g: +Math.min(20, Math.max(0.001, b.g * 10 ** (step / 20))).toFixed(4) };
  });
}
await browser.close();

console.log("\nband    rec dB   synth dB   error");
CENTRES.forEach((fc, i) =>
  console.log(`${String(fc).padStart(5)}  ${r.ref.shape[i].toFixed(1).padStart(7)}  ${r.syn.shape[i].toFixed(1).padStart(8)}  ${(r.syn.shape[i] - r.ref.shape[i]).toFixed(1).padStart(6)}`),
);
console.log("\nYour preset (pass as createPencilVoice({ config: … }), or save as JSON for --from):");
console.log(JSON.stringify({ bands: preset.bands, outGain: preset.outGain }, null, 2));

// End-to-end check in a real browser (headless Chromium via Playwright): serves the repo on localhost (a secure
// context, so AudioWorklet exists), drives all three demos in examples/index.html, and asserts the synth is actually
// played: pressure rises, sharp-turn ticks and pen-landing touches fire, the processor loads as its own file (no blob:),
// nothing plays before a gesture, and the `inline` build works too.
//
// Run: npm run build && npm run test:browser      (CHROME=/path/to/chrome to use a specific browser binary)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const INLINE_PAGE = `<!doctype html><script type="module">
  import { createPencilVoice } from "/dist/inline.js";
  const v = createPencilVoice();
  window.result = v.ready.then((ok) => ({ ok, state: v.context?.state }));
</script>`;

const served = [];
const missing = [];
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  served.push(path);
  if (path === "/__inline.html") return res.writeHead(200, { "content-type": "text/html" }).end(INLINE_PAGE);
  const file = normalize(join(root, path.endsWith("/") ? `${path}index.html` : path));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  const body = await readFile(file).catch(() => null);
  if (!body) return missing.push(path), res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const failures = [];
const check = (label, fn) => {
  try {
    fn();
    console.log(`  ok  ${label}`);
  } catch (e) {
    console.error(`FAIL  ${label}: ${e.message}`);
    failures.push(label);
  }
};

// Counts what reaches the synth: pressure targets above zero, and burst messages (ticks + touches).
const spy = () => {
  window.__pv = { pressure: 0, bursts: 0 };
  const W = window.AudioWorkletNode;
  window.AudioWorkletNode = class extends W {
    constructor(...a) {
      super(...a);
      const node = this;
      const send = this.port.postMessage.bind(this.port);
      this.port.postMessage = (m) => (m?.type === "burst" && window.__pv.bursts++, send(m));
      const set = AudioParam.prototype.setTargetAtTime;
      const pressure = node.parameters.get("pressure");
      pressure.setTargetAtTime = (v, t, c) => (v > 0 && window.__pv.pressure++, set.call(pressure, v, t, c));
    }
  };
};

// Before any gesture: scrolling must not make sound (browsers forbid it, and the voice must not try). Its own page,
// because the scroll demo's ink never un-draws.
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.addInitScript(spy);
  await page.goto(`${base}/examples/`, { waitUntil: "networkidle" });
  await page.mouse.move(600, 400);
  for (let k = 0; k < 20; k++) await page.mouse.wheel(0, 120), await page.waitForTimeout(16);
  const before = await page.evaluate(() => ({ ...window.__pv, state: window.voice.context?.state }));
  check("silent before a gesture (context still suspended, no pressure)", () => {
    assert.notEqual(before.state, "running");
    assert.equal(before.pressure, 0);
  });
  await page.close();
}

{
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.addInitScript(spy);
  served.length = 0;
  await page.goto(`${base}/examples/`, { waitUntil: "networkidle" });
  const pv = () => page.evaluate(() => ({ ...window.__pv }));

  await page.click("#enable");
  await page.waitForFunction(() => window.voice.context?.state === "running");
  check("processor loaded as its own file (served once)", () =>
    assert.equal(served.filter((p) => p === "/dist/pencil-processor.js").length, 1));

  // 1. Scroll through the whole track.
  const scrollStart = await pv();
  const trackEnd = await page.evaluate(() => {
    const t = document.getElementById("track");
    return t.getBoundingClientRect().top + scrollY + t.offsetHeight;
  });
  await page.mouse.move(600, 400);
  for (let y = 0; y < trackEnd; y += 60) await page.mouse.wheel(0, 60), await page.waitForTimeout(16);
  const afterScroll = await pv();
  console.log("     scroll demo: pressure updates", afterScroll.pressure - scrollStart.pressure, "bursts", afterScroll.bursts - scrollStart.bursts);
  check("scroll demo: pressure rises while drawing", () => assert.ok(afterScroll.pressure - scrollStart.pressure >= 12, "fewer voiced steps than the ~16 wheel steps that draw ink"));
  check("scroll demo: ticks and touches fire (arrowhead turns, three pen landings)", () =>
    assert.ok(afterScroll.bursts - scrollStart.bursts >= 3));

  // Scrolling back up leaves the ink and stays quiet.
  for (let k = 0; k < 15; k++) await page.mouse.wheel(0, -60), await page.waitForTimeout(16);
  const afterUp = await pv();
  check("scroll demo: scrolling back up is silent", () => assert.equal(afterUp.pressure, afterScroll.pressure));

  // 2. Drag the slider.
  await page.locator("#drag").scrollIntoViewIfNeeded();
  const s0 = await pv();
  const box = await page.locator("#drag").boundingBox();
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let k = 1; k <= 30; k++) await page.mouse.move(box.x + (box.width * k) / 30, box.y + box.height / 2), await page.waitForTimeout(16);
  await page.mouse.up();
  const s1 = await pv();
  check("drag demo: pressure rises while dragging", () => assert.ok(s1.pressure - s0.pressure > 10));

  // 3. Write over time.
  await page.locator("#write").scrollIntoViewIfNeeded();
  const w0 = await pv();
  await page.click("#write");
  await page.waitForTimeout(2300);
  const w1 = await pv();
  check("time demo: pressure rises while writing", () => assert.ok(w1.pressure - w0.pressure > 30));

  // Knobs reach the voice.
  await page.locator("#k-max").fill("0.4");
  const max = await page.evaluate(() => window.voice.config.max);
  check("knobs: max is now 0.4", () => assert.equal(max, 0.4));

  check("no page errors, and nothing missing but the favicon", () => {
    assert.deepEqual(errors.filter((e) => !e.includes("404")), []);
    assert.deepEqual(missing.filter((p) => p !== "/favicon.ico"), []);
  });
  await page.close();
}

{
  const page = await browser.newPage();
  await page.goto(`${base}/__inline.html`);
  const r = await page.evaluate(() => window.result);
  check("inline build: the synth loads from the inlined source", () => assert.equal(r.ok, true));
  await page.close();
}

await browser.close();
server.close();
if (failures.length) {
  console.error(`\n${failures.length} browser check(s) failed`);
  process.exit(1);
}
console.log("\nall browser checks passed");

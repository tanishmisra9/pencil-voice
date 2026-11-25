// The same API, with the synth inlined: no separate file to host. For script tags, CDNs and setups that can't resolve
// `new URL(…, import.meta.url)`. Costs a few KB in your JS bundle (not cached on its own) and loads the worklet from a
// Blob URL, which a strict Content-Security-Policy may block (`worker-src blob:` / `script-src blob:`).
import { createPencilVoice as create, loadPencilProcessor as load } from "./voice.js";
import source from "./processor-source.js";
let url = null;
const blobUrl = () => (url ?? (url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }))));
export function createPencilVoice(options = {}) {
    return create({ ...options, processorUrl: typeof window === "undefined" ? undefined : blobUrl() });
}
export function loadPencilProcessor(ctx) {
    return load(ctx, blobUrl());
}
export { followStroke } from "./follow.js";
export { createPencilNode } from "./voice.js";
export { createStroke, samplePath, resample } from "./stroke.js";
export { graphite } from "./presets.js";

// Tap-to-select: Segment Anything (Meta, Apache-2.0; ONNX export by rembg, MIT) on onnxruntime-web (MIT).
// Runs in a worker so the page stays responsive. Model files are served by this site and cached on the device.
import * as ort from "./ort/ort.wasm.min.mjs";

ort.env.wasm.wasmPaths = new URL("./ort/", import.meta.url).href;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

const MODELS = new URL("../models/sam/", import.meta.url).href;
const ENCODER = ["encoder.part0", "encoder.part1", "encoder.part2", "encoder.part3"];
const SIZES = { "encoder.part0": 28000000, "encoder.part1": 28000000, "encoder.part2": 28000000, "encoder.part3": 24836115, "decoder.onnx": 8755366 };
const CACHE = "eskeml-sam-v1";
let enc = null, dec = null, emb = null, size = null;

async function getFile(name, onBytes) {
  let cache = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(MODELS + name); if (hit) { const b = new Uint8Array(await hit.arrayBuffer()); onBytes(b.length); return b; } } catch {}
  const r = await fetch(MODELS + name);
  if (!r.ok) throw new Error("Couldn't download the selection AI (" + r.status + "). Check the internet connection and try again.");
  const reader = r.body.getReader(), parts = []; let n = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); n += value.length; onBytes(value.length); }
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  try { if (cache) await cache.put(MODELS + name, new Response(out)); } catch {}
  return out;
}

async function load() {
  if (enc && dec) return;
  const total = Object.values(SIZES).reduce((a, b) => a + b, 0); let got = 0, last = -1;
  const tick = k => { got += k; const p = Math.min(99, Math.floor(got / total * 100)); if (p !== last) { last = p; postMessage({ type: "progress", pct: p }); } };
  const files = await Promise.all([...ENCODER, "decoder.onnx"].map(f => getFile(f, tick)));
  const encBytes = new Uint8Array(files.slice(0, 4).reduce((a, b) => a + b.length, 0)); let o = 0;
  for (const f of files.slice(0, 4)) { encBytes.set(f, o); o += f.length; }
  postMessage({ type: "progress", pct: 100 });
  const opts = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
  enc = await ort.InferenceSession.create(encBytes, opts);
  dec = await ort.InferenceSession.create(files[4], opts);
}

onmessage = async ({ data: m }) => {
  try {
    if (m.type === "embed") {
      await load();
      postMessage({ type: "working" });
      // the export resizes, normalises and pads internally: it takes the RGB image as float HWC
      const o = await enc.run({ input_image: new ort.Tensor("float32", m.rgb, [m.h, m.w, 3]) });
      emb = o.image_embeddings; size = [m.h, m.w];
      postMessage({ type: "embedded", id: m.id });
    } else if (m.type === "mask") {
      if (!emb) throw new Error("Tap again: the photo isn't ready yet.");
      const s = 1024 / Math.max(size[0], size[1]), pts = m.points;
      const coords = new Float32Array((pts.length + 1) * 2), labels = new Float32Array(pts.length + 1);
      pts.forEach((p, i) => { coords[i * 2] = p.x * s; coords[i * 2 + 1] = p.y * s; labels[i] = p.label; });
      labels[pts.length] = -1; // padding point, as the SAM decoder expects without a box
      const o = await dec.run({
        image_embeddings: emb,
        point_coords: new ort.Tensor("float32", coords, [1, pts.length + 1, 2]),
        point_labels: new ort.Tensor("float32", labels, [1, pts.length + 1]),
        mask_input: new ort.Tensor("float32", new Float32Array(256 * 256), [1, 1, 256, 256]),
        has_mask_input: new ort.Tensor("float32", new Float32Array([0]), [1]),
        orig_im_size: new ort.Tensor("float32", new Float32Array(size), [2]),
      });
      const masks = o.masks, n = masks.dims[1], hw = size[0] * size[1], iou = o.iou_predictions.data;
      let best = 0; for (let i = 1; i < n; i++) if (iou[i] > iou[best]) best = i;
      const out = new Float32Array(masks.data.buffer.slice(masks.data.byteOffset + best * hw * 4, masks.data.byteOffset + (best + 1) * hw * 4));
      postMessage({ type: "mask", id: m.id, mask: out, w: size[1], h: size[0], n }, [out.buffer]);
    }
  } catch (e) { postMessage({ type: "error", id: m.id, message: e.message || String(e) }); }
};

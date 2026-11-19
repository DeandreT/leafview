// One dedicated worker and one unshared linear memory per open document.
const MAX_BYTES = 64 * 1024 * 1024;
let wasm;

let receiveCode;
const code = new Promise(resolve => { receiveCode = resolve; });

async function open(url) {
  const [instance, response] = await Promise.all([
    code.then(module => WebAssembly.instantiate(module, {})), fetch(url),
  ]);
  if (!response.ok) throw new Error(`PDF download failed (HTTP ${response.status})`);
  if (Number(response.headers.get("content-length")) > MAX_BYTES) {
    throw new Error("PDF exceeds 64 MiB");
  }
  if (!response.body) throw new Error("PDF download has no body");
  wasm = instance.exports;
  // Stream into WASM. Enforce the limit on decoded bytes, even when
  // Content-Length is absent or describes a compressed response.
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value.byteLength) continue;
      const ptr = wasm.input_chunk(value.byteLength);
      if (!ptr) throw new Error("PDF exceeds 64 MiB");
      new Uint8Array(wasm.memory.buffer, ptr, value.byteLength).set(value);
    }
  } finally {
    reader.releaseLock();
  }
  const pageCount = wasm.open_pdf();
  if (pageCount === -2) throw new Error("PDF must contain 1–250 pages");
  if (pageCount <= 0) throw new Error("Hayro could not open this PDF (invalid or password protected)");
  return pageCount;
}

self.onmessage = async ({ data: { id, type, url, page, width, module } }) => {
  try {
    if (type === "code") { receiveCode(module); return; }
    if (type === "open") {
      self.postMessage({ id, pageCount: await open(url) });
      return;
    }
    if (type !== "render" || !wasm) throw new Error("Unexpected worker request");
    const height = wasm.render_page(page, width);
    if (height <= 0) {
      self.postMessage({ id, error: height === -3 ? "Invalid page" : "Invalid page dimensions or render exceeds 8192 px per edge / 4 MP" });
      return;
    }
    // Linear memory cannot be transferred. Copy once to a transferable buffer
    // and release the Rust pixmap before returning to the event loop.
    const pixels = new Uint8ClampedArray(wasm.memory.buffer, wasm.pixels(), width * height * 4).slice();
    wasm.release_pixels();
    self.postMessage({ id, width, height, pixels: pixels.buffer }, [pixels.buffer]);
  } catch (e) {
    // Discard this instance after a trap, fetch failure or unexpected exception.
    self.postMessage({ id, fatal: String(e?.message ?? e) });
    self.close();
  }
};

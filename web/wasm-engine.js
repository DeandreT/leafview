/**
 * Parse a PDF in a dedicated worker. render() sizes the backing canvas to
 * the requested pixel width. destroy() aborts pending work and releases all
 * document, render-cache, pixel and WASM memory owned by the worker.
 */
export async function openDocument(url) {
  const absoluteURL = new URL(url, document.baseURI).href;
  const worker = new Worker(new URL("./wasm-worker.js", import.meta.url), { type: "module" });
  const pending = new Map();
  let nextID = 0;
  let stopped;

  function stop(reason) {
    if (stopped) return;
    stopped = reason;
    worker.terminate();
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(reason);
    }
    pending.clear();
  }
  worker.onerror = (e) => stop(new Error(e.message || "PDF worker failed"));
  worker.onmessageerror = () => stop(new Error("Could not decode PDF worker response"));
  worker.onmessage = ({ data }) => {
    if (data.fatal) return stop(new Error(`Hayro: ${data.fatal}`));
    const request = pending.get(data.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data);
  };
  function rpc(message) {
    if (stopped) return Promise.reject(stopped);
    if (pending.size >= 16) return Promise.reject(new Error("Too many pending PDF requests"));
    const id = ++nextID;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => stop(new Error("PDF worker timed out")), 90_000);
      pending.set(id, { resolve, reject, timer });
      try {
        worker.postMessage({ id, ...message });
      } catch (e) {
        stop(e);
      }
    });
  }

  const { pageCount } = await rpc({ type: "open", url: absoluteURL });
  return {
    pageCount,
    async render(pageOneBased, width, canvas) {
      if (stopped) throw stopped;
      if (!Number.isInteger(pageOneBased) || pageOneBased < 1 || pageOneBased > pageCount) {
        throw new RangeError(`Page must be an integer from 1 to ${pageCount}`);
      }
      if (!Number.isInteger(width) || width < 1 || width > 8192) {
        throw new RangeError("Width must be an integer from 1 to 8192 pixels");
      }
      const ctx = canvas?.getContext?.("2d");
      if (!ctx) throw new Error("Render target must be a canvas with a 2D context");
      const { pixels, height } = await rpc({ type: "render", page: pageOneBased, width });
      if (stopped) throw stopped;
      canvas.width = width;
      canvas.height = height;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
    },
    destroy() {
      stop(new Error("Document destroyed"));
    },
  };
}

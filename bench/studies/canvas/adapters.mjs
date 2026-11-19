// Benchmark-only virtual modules. Keep production open/compile, worker lifetime,
// error handling, RPC and WASM render calls identical. Fail on source drift.
export function bitmapModules(engine, worker) {
  function replace(s, from, to) {
    if (!s.includes(from) || s.indexOf(from) !== s.lastIndexOf(from)) throw Error(`Adapter anchor changed: ${from}`);
    return s.replace(from, to);
  }
  engine = replace(engine, 'getContext?.("2d")', 'getContext?.("bitmaprenderer")');
  engine = replace(engine, "canvas with a 2D context", "canvas with a bitmaprenderer context");
  engine = replace(engine, "const { pixels, height }", "const { bitmap, height }");
  engine = replace(engine, "ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);",
    "try { ctx.transferFromImageBitmap(bitmap); } finally { bitmap.close(); }");
  worker = replace(worker, "let wasm;", "let wasm, target, ctx;");
  const start = worker.indexOf("    // Linear memory cannot be transferred.");
  const end = worker.indexOf("\n  } catch", start);
  if (start < 0 || end < start || !worker.slice(start, end).includes(".slice()")) throw Error("Worker anchor changed");
  worker = worker.slice(0, start) + `    // No JS pixel copy: build ImageData over this post-render memory view.
    // putImageData consumes it synchronously; only then can Rust release it.
    if (!target) {
      target = new OffscreenCanvas(width, height);
      ctx = target.getContext("2d");
    }
    if (target.width !== width) target.width = width;
    if (target.height !== height) target.height = height;
    try {
      const pixels = new Uint8ClampedArray(wasm.memory.buffer, wasm.pixels(), width * height * 4);
      const image = new ImageData(pixels, width, height);
      if (image.data.buffer !== pixels.buffer) throw Error("ImageData did not alias WASM");
      ctx.putImageData(image, 0, 0);
    } finally { wasm.release_pixels(); }
    const bitmap = target.transferToImageBitmap();
    self.postMessage({ id, width, height, bitmap }, [bitmap]);` + worker.slice(end);
  return { engine, worker };
}

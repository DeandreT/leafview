// bun scripts/precompress.mjs [output-dir]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { brotliCompressSync, brotliDecompressSync, constants, gunzipSync, gzipSync } from "node:zlib";

export const rendererAssets = ["wasm-engine.js", "wasm-worker.js", "pkg/folio_wasm.wasm"];
export const brotliQuality = 11, gzipLevel = 9;
export function encode(raw) {
  const br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: brotliQuality } });
  const gzip = gzipSync(raw, { level: gzipLevel });
  if (!brotliDecompressSync(br).equals(raw) || !gunzipSync(gzip).equals(raw)) throw Error("Invalid sidecar");
  return { br, gzip };
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const output = resolve(process.argv[2] || `${root}/artifacts/delivery`);
  for (const path of rendererAssets) {
    const raw = readFileSync(`${root}/web/${path}`);
    const { br, gzip } = encode(raw);
    const dest = resolve(output, path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, raw);
    writeFileSync(`${dest}.br`, br);
    writeFileSync(`${dest}.gz`, gzip);
    console.log(`${path}: ${raw.length} bytes, br ${br.length}, gzip ${gzip.length}`);
  }
}

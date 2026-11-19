// bun scripts/precompress.mjs [output-dir]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { brotliCompressSync, brotliDecompressSync, constants, gunzipSync, gzipSync } from "node:zlib";
import { resources, verifyResource } from "./renderer-resources.mjs";

export const rendererAssets = ["wasm-engine.js", "wasm-worker.js", "pkg/folio_wasm.wasm"];
export const resourceAssets = resources.map(r => r.path);
const root = resolve(import.meta.dir, "..");
const notices = ["COPYING", "THIRD_PARTY_NOTICES.md", "pkg/THIRD_PARTY_NOTICES.txt", "pkg/RUST-STDLIB-NOTICES.html"];
const source = path => resolve(root, path === "COPYING" || path === "THIRD_PARTY_NOTICES.md" ? "." : "web", path);
export const brotliQuality = 11, gzipLevel = 9;
export function encode(raw) {
  const br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: brotliQuality } });
  const gzip = gzipSync(raw, { level: gzipLevel });
  if (!brotliDecompressSync(br).equals(raw) || !gunzipSync(gzip).equals(raw)) throw Error("Invalid sidecar");
  return { br, gzip };
}

// Check the deployed bytes, not just encoder output or the existence of files.
export function verifyDelivery(output) {
  for (const path of [...rendererAssets, ...resourceAssets, ...notices]) {
    const dest = resolve(output, path), raw = readFileSync(dest);
    if (!raw.length || !raw.equals(readFileSync(source(path)))) throw Error(`Stale or empty ${path}`);
    if (path.endsWith(".wasm")) {
      const imports = WebAssembly.Module.imports(new WebAssembly.Module(raw));
      if (imports.length !== 1 || imports[0].module !== "leafview" ||
          imports[0].name !== "copy_asset" || imports[0].kind !== "function")
        throw Error(`Not a split renderer: run scripts/build-wasm.mjs`);
    }
    const r = resources.find(r => r.path === path);
    if (r) verifyResource(r, raw);
    if (!notices.includes(path) && (!brotliDecompressSync(readFileSync(`${dest}.br`)).equals(raw) ||
        !gunzipSync(readFileSync(`${dest}.gz`)).equals(raw))) throw Error(`Invalid delivery sidecar for ${path}`);
  }
}

if (import.meta.main) {
  const verifyOnly = process.argv[2] === "--verify";
  const output = resolve(process.argv[verifyOnly ? 3 : 2] || `${root}/artifacts/delivery`);
  if (!verifyOnly) for (const path of [...rendererAssets, ...resourceAssets, ...notices]) {
    const raw = readFileSync(source(path));
    const r = resources.find(r => r.path === path);
    if (r) verifyResource(r, raw);
    const dest = resolve(output, path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, raw);
    if (notices.includes(path)) continue;
    const { br, gzip } = encode(raw);
    writeFileSync(`${dest}.br`, br);
    writeFileSync(`${dest}.gz`, gzip);
    console.log(`${path}: ${raw.length} bytes, br ${br.length}, gzip ${gzip.length}`);
  }
  verifyDelivery(output);
  console.log(`Verified renderer, 12 resources, delivery encodings and notices: ${output}`);
}

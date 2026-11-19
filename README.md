# Leafview

A Rust/WebAssembly PDF **page preview** for the browser. Hayro runs in a dedicated web worker. The viewer uses the same controls, preview sizes, thumbnail scheduling and cache policy for Leafview and the PDF.js comparator.

```js
import { openDocument } from "./web/wasm-engine.js";

const doc = await openDocument("/example.pdf");
try {
  await doc.render(1, 900, document.querySelector("canvas"));
} finally {
  await doc.destroy();
}
```

The prototype covers the canvas preview used in a packet-review UI. Text selection, accessible text layers, search, interactive forms and annotations are separate viewer features.

## Benchmark

The fixtures include text invoices, JPEG-based scan pages and rotated pages in 25- and 250-page packets. Each page encodes its document and page number as pixels. The scan asset is reused within a packet, so the corpus exercises navigation and cache behavior more than network throughput on large independent scans.

**PDF.js wins first visits over a constrained network; Leafview wins subsequent packet opens in the same tab.** Leafview now compiles the renderer once per tab and shares the compiled code with new workers. Each PDF still has its own worker, private memory, and render cache. The release build uses WASM SIMD, whole-program optimization and a single code generation unit. Use a browser with WASM SIMD support.

| 250-page packet, desktop Chromium | PDF.js | Leafview |
|---|---:|---:|
| Cold first preview, loopback | 213 ms | 115 ms |
| Cold first preview, paced gzip delivery | 1.05 s | 1.65 s |
| Next distinct 25-page packet, same tab, paced | 698 ms | 381 ms |
| Reopen cached document, loopback | 29 ms | 13 ms |
| Last click, median / p95 | 40 / 47 ms | 30 / 48 ms |
| Browser private memory after ten 25-page packets | 174 MiB | 143 MiB |
| Requested engine assets, gzip | 0.42 MB | 1.85 MB |

Before module sharing, the second distinct packet took [1.65 s](results/paced-before.json) in the same paced, `no-store` test. The 0.38 s result measures opening another document, not reopening a cached PDF. A production HTTP cache could narrow this difference. A smaller `opt-level="s"` scalar build cut the gzip payload to 1.66 MB, but pushed 250-page click p95 to 91 ms, so the speed build is preferred.

Both engines used selected-page-first rendering, visible-only thumbnails, and at most two cached documents. Six alternating rounds in headless Chromium; first preview is measured from packet open in a loaded shell to the render-complete animation frame. The paced test adds 40 ms per request and serves gzipped responses at 10 Mbit/s **per response**, not an aggregate bandwidth cap. All 144 final click targets matched their page and packet pixel marker. Full-page ink overlap on five additional renders was 0.939–0.965; these checks cover layout and orientation, not full PDF feature parity.

[Full 25- and 250-page timings and memory samples](results/observations.json) · [Paced first visits](results/paced.json) · [Visual checks](results/fidelity.json)

## Reproduce or try it

With Bun, Rust/rustup, and Python 3.12 in a virtual environment:

```sh
bun install --frozen-lockfile
bun scripts/build-wasm.mjs
python -m pip install --only-binary=:all: reportlab==4.4.3 pillow==11.3.0
python bench/generate.py
bunx --bun playwright install chromium
bun bench/run.ts --smoke
bun bench/fidelity.ts
bun bench/run.ts artifacts/local-results.json
python bench/summarize.py artifacts/local-results.json
bun bench/run.ts --paced
```

`bun bench/run.ts --serve` prints a local address. Visit `/demo.html` at that address to open a local PDF in Leafview.

## License

GPL-3.0-only. Copyright Deandre Thomas. See [COPYING](COPYING) and [dependency notices](THIRD_PARTY_NOTICES.md).

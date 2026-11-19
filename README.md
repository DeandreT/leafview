# Folio WASM

A Rust/WebAssembly PDF **page preview** for the browser. Hayro runs in a dedicated web worker. The viewer uses the same controls, preview sizes, thumbnail scheduling and cache policy for Folio and the PDF.js comparator.

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

## License

GPL-3.0-only. Copyright Deandre Thomas. See [COPYING](COPYING) and [dependency notices](THIRD_PARTY_NOTICES.md).

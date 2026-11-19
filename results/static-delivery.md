# Cold starts with static Brotli delivery

**Ship the Brotli sidecar for first visits.** It removes 416,598 bytes (22.6%) from the WASM download and cuts the median first preview by 327 ms (19.9%). PDF.js still opens the first packet 316 ms sooner with matching Brotli. On the next distinct packet, WASM reuses the compiled module and opens 275 ms sooner than PDF.js.

| Engine / encoding | WASM bytes transferred, first / next | Largest first-open response | Single-response floor | First preview | Next preview |
|---|---:|---|---:|---:|---:|
| PDF.js / gzip 9 | 0 / 0 | PDF: 462,565 B | 410 ms | 1,055 ms | 687 ms |
| WASM / gzip 9 | 1,843,627 / 0 | WASM binary | 1,515 ms | 1,647 ms | 395 ms |
| PDF.js / Brotli 11 | 0 / 0 | PDF: 433,292 B | 387 ms | 1,004 ms | 660 ms |
| WASM / Brotli 11 | 1,427,029 / 0 | WASM binary | 1,182 ms | 1,320 ms | 385 ms |

Timings are medians of six rounds per case; all 48 opens passed the marker checks. The floor is `40 ms + largest encoded response bytes / 1,250 bytes per ms`. For WASM under Brotli, that is 1,142 ms of body transfer plus 40 ms delay; the observed first preview is just 138 ms above it. The binary response alone already exceeds PDF.js's entire observed 1,004 ms first preview. The floor is not a sum of parallel transfers, and the difference is not a CPU-time measurement: imports, additional requests, worker startup, decoding, compilation and paint can overlap. The fresh gzip first-preview medians reproduce the original 1.05 s / 1.65 s control.

**Size-only quality check:** On the identical 4,574,693-byte WASM binary, Brotli quality 10 produced 1,474,471 bytes. Quality 11 removes a further 47,442 bytes (3.2%), worth just 38 ms on the transfer floor at this rate. Only quality 11 was browser-timed.

## Reproduce the measurement

From the repository root, with the release WASM, fixtures, Bun dependencies and Playwright Chromium installed:

```sh
bun scripts/precompress.mjs
bun bench/run.ts --paced
bun scripts/summarize-paced.mjs
```

The default run writes `artifacts/paced-codecs.json`. `BENCH_PACED_OUTPUT` overrides that path. [The recorded run](paced-codecs.json) includes every sample, per-request encoded body sizes, input hashes, versions and fixture sizes. The earlier [gzip control](paced.json) and [pre-module-sharing baseline](paced-before.json) are separate runs.

## Deploy the sidecars

The measurements above used the original embedded build. For the current build see [renderer packaging and resource checks](../docs/renderer-delivery.md). The static export includes both renderer modules, the WASM binary, twelve on-demand data files, and license notices. The default output directory is `artifacts/delivery/`. Publish this entire directory under one versioned prefix.

Keep application URLs unchanged (e.g. `pkg/folio_wasm.wasm`). Have the static server negotiate `Accept-Encoding`, including an identity fallback, and send `Vary: Accept-Encoding`. A selected sidecar needs the **original MIME type** (`application/wasm` or JavaScript) and its `Content-Encoding` (`br` or `gzip`); the WASM loader can then compile the decoded stream. For example, in a Caddy site serving the assembled application:

```caddyfile
file_server {
    precompressed br gzip
}
```

Check with `curl -I -H 'Accept-Encoding: br' https://HOST/PREFIX/pkg/folio_wasm.wasm`, then repeat with `gzip` and `identity`. Check the encoding, type and encoded length. Configure any CDN to retain the encoding variant in its cache key. Use immutable caching only under versioned URLs; the study's `no-store` setting is for measurement.

## Protocol

Each of six rounds runs PDF.js and WASM under **both** encodings. Odd rounds use gzip/PDF.js, gzip/WASM, Brotli/PDF.js, Brotli/WASM; even rounds reverse the list. Each case starts in a fresh browser context in a shared headless Chromium process, after the shell has loaded. Every response, including worker scripts and PDFs, gets the selected encoding, a 40 ms request delay, and its own 10 Mbit/s pacing clock (32 KiB chunks). These are independent response budgets, not a shared network bottleneck. All representations are prepared before timing; the WASM engine serves the actual deployment sidecars.

Time runs from opening the 250-page document to the first main-canvas render-complete animation frame. After the visible thumbnails settle, the same tab opens a **distinct** 25-page document. Both opens check the page/document pixel marker on the main canvas and on all settled visible thumbnails. Chromium's `encodedBodySize` for the WASM fetch is checked against both the sidecar length and the server's body-byte count; the second open must not request the binary again. Byte counts exclude headers and framing.

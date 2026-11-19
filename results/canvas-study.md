# Worker canvas presentation in Chromium

**Result:** The worker-side `OffscreenCanvas` path showed a consistent benefit at 1600 px: median render completion dropped by 4.2 ms, sampled peak private memory by 64.3 MiB, and p95 verified frame time by 6.4 ms. At 900 px it saved memory, but p95 verified frame time rose from 40.3 to 57.6 ms. Median verified frame times stayed near 31 ms at both widths. Prioritize a high-resolution preview trial; this sample does not support switching all preview sizes for latency.

Fresh headless Chromium 158.0.8127.18, Bun 1.4.5, Windows 10.0.26300, AMD Ryzen 7 PRO 8840U, DPR 1. Numbers are **median / p95** (nearest-rank p95). Each timing cell pools 72 observations; each memory cell summarizes six independently launched browser peaks, so memory p95 is the maximum observed.

| Intrinsic width | Presentation path | Request → render resolved, ms | Main canvas method, ms | Request → verified after two rAFs, ms | Sampled peak private MiB |
|---:|---|---:|---:|---:|---:|
| 900 | RGBA baseline | 5.75 / 30.8 | 0.90 / 2.0 | 31.35 / 40.3 | 168.3 / 179.2 |
| 900 | Worker bitmap | 5.30 / 30.9 | <0.1 / 0.1 | 31.60 / 57.6 | 143.8 / 148.2 |
| 1600 | RGBA baseline | 12.40 / 36.1 | 2.60 / 5.0 | 30.95 / 49.0 | 251.8 / 254.5 |
| 1600 | Worker bitmap | 8.20 / 29.0 | <0.1 / 0.1 | 31.65 / 42.6 | 187.5 / 188.7 |

At width 1600, median render completion improved 34% and median sampled peak fell 26%; the bitmap path had a lower round-median render time in all six paired rounds. At 900, the pooled median gain was 0.45 ms (8%) and median sampled peak fell 24.4 MiB (15%); render time favored the bitmap path in only three of six rounds. Scans remained the slowest class: their median render times improved from 28.05 to 21.10 ms at 1600 but worsened from 22.35 to 27.15 ms at 900. Display-width downscaling and scheduling are shared by both arms.

## What was compared

- **Baseline:** actual `web/wasm-engine.js` and `web/wasm-worker.js` served unchanged. Hayro rasterizes in the worker; `.slice()` copies WASM RGBA into a transferable buffer; main constructs `ImageData` over the transferred buffer and calls `putImageData`.
- **Bitmap:** the local adapter derives two virtual modules from those same sources. After `render_page`, it constructs `ImageData` over the current unshared WASM memory view and checks that its data aliases the buffer. It calls `putImageData` on a retained worker `OffscreenCanvas`, releases the Rust pixels, calls `transferToImageBitmap`, transfers the bitmap, and presents it on an attached HTML canvas with `bitmaprenderer.transferFromImageBitmap`. The benchmark fails if these APIs or aliasing are unavailable. This removes the **explicit JS full-frame copy**, not rasterization, canvas backing-store writes, or all browser-internal copies. Intrinsic dimensions: 900 × 1165 or 695; 1600 × 2071 or 1236. A 1600 × 2071 RGBA frame is 12.64 MiB; differences in peak memory are for the whole browser and cannot be attributed solely to one such allocation.
- Both load the already-built `web/pkg/folio_wasm.wasm` (SHA-256 `a17961649ab20bba89cc55f0f449c9a69441df70bfeed96661e3977d19817a45`). Local fixture `p25` has simple portrait invoices, synthetic grayscale scans (a repeated JPEG), and rotated landscape invoices.

## Timing and correctness

Six paired rounds per width, with arm order AB/BA and width order reversed each round. Each arm/width/round launches a fresh browser, opens the document, and warms pages 1/2/3 before sampling. There are 12 sequential renders per run: four per page class, using pages 1/2/3/4/5/8, with the sequence rotated by round. One document, worker, displayed canvas (CSS width 600 px), and request in flight. No thumbnails, cancellation, cross-document parallelism, cold-start measurement, or simultaneous benchmark browser. The PowerShell launcher holds `Local\LeafviewBrowserStudy2026` for the complete experiment; unrelated OS load is uncontrolled.

`renderMs` spans the browser-side request through the resolved presentation call (including worker rasterization). `mainSubmitMs` wraps only the synchronous main canvas method, not canvas resize, scheduling, or compositor work. All timers are in the main realm; measured `performance.now()` resolution was 0.1 ms, non-cross-origin-isolated. A recorded zero is below resolution. `verifiedMs` stops after two `requestAnimationFrame` callbacks and a backing-canvas marker read via a separate one-pixel canvas. This is a paint opportunity in a headless browser, not photon latency. Frame alignment quantizes it; the pooled tails come from only six independent sessions per arm/width.

All **288/288 timed markers** passed. Outside timing, all **12 paired full-frame SHA-256 hashes** of RGBA read back from the displayed canvas matched exactly (six pages × two widths), dimensions matched, and **24/24 actual viewport screenshot markers** passed (each case, both modes). Readbacks target separate 2D canvases, not the presentation context. Each screenshot is clipped to the CSS-scaled marker center (1 × 1 pixel); full-frame hashes use intrinsic pixels.

## Private memory

A separate Python process calls Windows `GetProcessMemoryInfo` and sums `PrivateUsage` for Chromium's CDP-reported browser, renderer (including the dedicated worker), GPU and network-service PIDs. PID set checked before/after each window. Sampling starts after warmup and ends after the timed sequence, before full-frame hashing and screenshots; no forced GC. Across 24 fresh browser runs there were 992 samples. Requested interval was 10 ms; observed median spacing per run was 10.5–10.8 ms and the largest gap was 19.5 ms. These are sampled lower bounds on instantaneous peak private commit, not GPU VRAM, WASM heap, or working-set peaks.

## Reproduce / next decision

From the repository root on Windows with the existing fixtures, WASM, dependencies and Playwright Chromium installed, and Bun 1.4.5 (`bun`), Python 3 (`python`) and PowerShell (`pwsh`) on PATH:

```powershell
pwsh -NoProfile -File bench/studies/canvas/run.ps1
```

The script overwrites [`canvas-study.json`](canvas-study.json) with raw samples, per-run memory measurements, process inventory, module/fixture hashes, fidelity records and summaries. The localhost server, workers, sampler, and browser instances close at the end. The prototype lives in [`bench/studies/canvas`](../bench/studies/canvas/); it does not change the shipped adapter.

Before shipping, exercise the real viewer's request queue, thumbnail churn, rapid packet switches and document teardown across target browsers. Select context type before the canvas is initialized; an existing 2D canvas cannot be switched to `bitmaprenderer`. Retain the production RGBA adapter as fallback when worker `OffscreenCanvas`, the bitmap context, or the WASM-backed `ImageData` path is unavailable. Close/dispose any stale or cancelled bitmap responses rather than retaining graphics resources.

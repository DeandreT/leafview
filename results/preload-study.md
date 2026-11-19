# Starting the renderer at packet-list readiness

**Preload on likely review sessions.** At 10 Mbit/s with a 40 ms request delay and a 500 ms pause before picking a packet, the median click-to-preview wait fell from 1,303 to 813 ms. At a 1,500 ms pause it fell from 1,322 to 519 ms. Immediate clicks gained little.

| Time spent choosing | Click to preview: on demand | Click to preview: preload | List ready to preview: on demand | List ready to preview: preload |
|---|---:|---:|---:|---:|
| Immediate | 1,315 ms | 1,302 ms | 1,315 ms | 1,303 ms |
| 500 ms | 1,303 ms | 813 ms | 1,812 ms | 1,321 ms |
| 1,500 ms | 1,322 ms | 519 ms | 2,835 ms | 2,027 ms |

**Cost of a list visit with no open:** 1,428,255 encoded body bytes with completed preloading, zero engine bytes on demand. Neither fetched a packet PDF. For opens, both transferred 1,862,586 body bytes after list readiness. The benefit comes from overlapping download and compilation with the time the user is choosing; it does not reduce transfer size.

The benchmark serves the same adapter in both arms, with a benchmark-only export of its memoized `loadCode` function. The early arm imports and compiles it at list readiness; the other waits for the click. The clock starts when the loaded list is available, not when the user first navigates to the application. Each arm uses a fresh context, Brotli, a per-response bandwidth budget, no HTTP cache and a 250-page packet. Six interleaved rounds, 36 verified opens and 12 no-open controls. Early exit before download completes, overhead during initial application navigation, and real-world packet-open probability are not measured.

Run `bun bench/run.ts --preload` after building fixtures and static sidecars. [Raw observations](preload-study.json).

As a sensitivity check, `BENCH_SHARED_LINK=1` gives the whole session one shared 10 Mbit/s budget. After a 500 ms pause, preloading reduced median click-to-preview from 1,701 to 1,194 ms (list-to-preview: 2,204 to 1,704 ms). After 1,500 ms it reduced it from 1,718 to 528 ms. Immediate clicks were essentially tied (1,695 vs 1,701 ms). [Shared-link observations](preload-shared-study.json).

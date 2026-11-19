# Independent JPEG scan packets: first preview

With 250 independent scan images, PDF.js range reads cut median first-preview time from **11.59 s to 11.15 s** and PDF body bytes by **73.4%**. Leafview fetched the full file and painted in **11.72 s**. The range path is a PDF.js comparator, not a Leafview feature. Repeating one raster across 250 pages changes the economics: PDF.js full versus range was 0.43 versus 0.65 s.

| Packet | File MiB | Mode | First preview (s) | PDF MiB by frame | PDF requests | All MiB by frame | All requests |
|---|---:|---|---:|---:|---:|---:|---:|
| 25-shared | 0.246 | leafview-full | 0.573 | 0.246 | 1 | 2.007 | 4 |
| 25-shared | 0.246 | pdfjs-full | 0.499 | 0.246 | 1 | 0.644 | 4 |
| 25-shared | 0.246 | pdfjs-range | 0.594 | 0.246 | 4 | 0.644 | 7 |
| 25-independent | 5.931 | leafview-full | 1.630 | 5.931 | 1 | 7.692 | 4 |
| 25-independent | 5.931 | pdfjs-full | 1.487 | 5.931 | 1 | 6.330 | 4 |
| 25-independent | 5.931 | pdfjs-range | 1.567 | 1.744 | 28 | 2.142 | 31 |
| 250-shared | 0.314 | leafview-full | 0.538 | 0.314 | 1 | 2.075 | 4 |
| 250-shared | 0.314 | pdfjs-full | 0.426 | 0.314 | 1 | 0.712 | 4 |
| 250-shared | 0.314 | pdfjs-range | 0.653 | 0.314 | 6 | 0.712 | 9 |
| 250-independent | 59.278 | leafview-full | 11.717 | 59.278 | 1 | 61.038 | 4 |
| 250-independent | 59.278 | pdfjs-full | 11.591 | 59.278 | 1 | 59.676 | 4 |
| 250-independent | 59.278 | pdfjs-range | 11.155 | 15.778 | 253 | 16.176 | 256 |

Each cell is a median of three rotating-order fresh-context runs. First preview is the host frame after rendering the selected page; all 36 page-count, page-marker and raster pixel checks passed. Request counts include canceled requests. Bytes are server writes through the frame, including gzip renderer code in “All” and any partial initial 200 in “PDF”. No-store; shell already loaded; CPU and process-level caches may be warm.

**Why the byte savings barely moved first paint:** for the 250 independent pages, the trace shows an initial 200 request followed by 252 partial responses. After reading the head and tail, PDF.js fetched many separate 64 KiB windows spread across this non-linearized file. Each incurred the modeled 40 ms header delay. The measured latency distributions overlap; the 73.4% drop in PDF bytes is the clearer result. On 25 independent pages, range reads likewise saved bytes but had a slightly slower median paint.

**Pacing check.** One origin-wide 50 Mbit/s schedule, 40 ms before each response's headers, 32768-byte slices and up to 2 simultaneous schedule waiters. During Leafview's large independent opens the PDF and WASM body intervals overlapped by a median 505 ms. Together they delivered 44.4 Mbit/s from first to last body write (median, excluding the first slice), not 50 Mbit/s per parallel response. This is server-side pacing, not a WAN replay.

[Raw samples, request headers/ranges, hashes and environment](scans-study.json) · [Method, reproduction and limitations](../bench/studies/scans/README.md)

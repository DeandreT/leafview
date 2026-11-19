# What can come out of the first download?

**The feature-preserving split saves 480,118 Brotli bytes (33.6%) on the invoice path.** The real first 250-page preview changed from **1,300 to 914 ms** (386 ms faster). That clears 400,000 bytes and 400 KiB. Keep the three common invoice fonts in the module; load the other eleven Base-14 substitutes and the predefined CMap bundle when the renderer requests them. The unadorned feature switches do lose text.

## Pinned binary and actual feature builds

Wasm sections include section framing; Brotli is the **whole raw file compressed once at quality 11**, never a sum of compressed sections.

| WASM | Raw B | Code B | Data B | Brotli B | Brotli saved vs current B |
|---|---:|---:|---:|---:|---:|
| current | 4,574,693 | 3,397,621 | 1,172,000 | 1,427,029 | 0 |
| default | 4,574,693 | 3,397,621 | 1,172,000 | 1,427,029 | 0 |
| fonts | 4,093,886 | 3,303,126 | 785,756 | 1,116,434 | 310,595 |
| cmaps | 4,308,868 | 3,396,734 | 907,064 | 1,211,198 | 215,831 |
| neither | 3,828,060 | 3,302,239 | 520,820 | 901,245 | 525,784 |
| lazy | 3,917,509 | 3,342,568 | 569,864 | 946,661 | 480,368 |

`current` is the shipped binary (a17961649ab20bba89cc55f0f449c9a69441df70bfeed96661e3977d19817a45); `default` is the clean staged release rebuild, SHA-256 identical. The full module is 74.3% code and 25.6% data. `fonts` = embed-fonts only; `cmaps` = embed-cmaps only.

* Fonts cost **215,831 B** with CMaps enabled; **215,189 B** without them.
* Predefined CMaps cost **310,595 B** with fonts enabled; **309,953 B** without them.
* Dropping both is a **525,784 B** upper bound for feature deletion, not an acceptable general renderer. These differences include removed parsing/decompression code and changes to whole-file compression, not just embedded file lengths. Identity-H/V have explicit built-in fast paths; they alone cannot validate named CMap coverage.

### Decoder attribution

The default release has no symbol names. A companion full-feature build retains the name section; its noncustom sections differ from the default, so treat the following as approximate. Counting function bodies with crate names present in their symbols gives **210,022 B JPEG 2000**, **258,570 B JBIG2**, **145,259 B JPEG**, **4,741 B CCITT**, and **40,947 B Brotli decompressor**. These are raw code-body counts, with inlining, shared helpers and code folding by LTO; they are not removable Brotli bytes. Hayro-interpret pins hayro-syntax's `images` feature on, which pulls in all four PDF image decoders. This experiment leaves them enabled. See the [raw data](bundle-study.json) for section sizes, complete group counts and largest named functions.

## Real previews, cold paths and quality

| Scenario | Current median | Split median | Split outcome |
|---|---:|---:|---:|
| First, 250-page invoice packet | 1,300 ms | 914 ms | 386 ms faster |
| Next distinct 25-page packet, same tab | 378 ms | 380 ms | 2 ms slower |
| Separate cold named-CMap fixture, engine render + frame | 1,283 ms | 1,127 ms | 156 ms faster |

Each timing cell is the median of six fresh-context cases with order alternated in headless Chromium 158.0.8127.18. Per-response delay 40 ms, 10 Mbit/s, 32 KiB chunks, no-store, static Brotli 11. Invoice timings use the unchanged host's open-to-main-canvas event after a rendering frame. The JIS case calls the production worker-backed engine directly and awaits the first animation frame. The 250-page PDF fetch overlaps the WASM fetch. The ordinary invoice packets made **zero** optional-resource requests; the next distinct open made zero additional WASM transfers. Bytes are encoded HTTP body bytes, excluding headers. All per-request logs and per-round timings are retained.

* First invoice renderer total (engine + worker + WASM): **1,429,279 → 949,161 B**. The main binary saves 480,368 B; the worker costs 250 B more. The model gives a 384 ms reduction in the longest response's transfer floor.
* Full 900px-wide RGBA hashes matched the current renderer for invoice pages 1 and 4, rotated page 3, scan page 2, a page using **every Base-14 font**, and JIS and Identity-H controls. The invoice title region had **2,910** dark pixels by default and **0** with fonts removed. The entire JIS text-only page had **9,405** dark pixels by default and **20,583** without predefined CMaps. This is a stronger check than packet markers or page counts.
* The /H case encodes Greek ΩβΔ in JIS X 0208 with an embedded TrueType font and CID-to-GID mapping. An independently encoded /Identity-H document addressing the same CIDs produced identical pixels. Only the named-CMap page required the **250,740 B** CMap body; Identity-H did not. The all-font sheet exercised the deferred font files. With an intentionally missing CMap sidecar, the worker returned an error and left the target canvas untouched.

## Shipping implications

This is a study prototype, reproducible with [the isolated build and browser scripts](../bench/studies/bundle/README.md). Both default resolvers and PDF decoder support are preserved. The CMap patch moves decompression outside Wasm: serve the decompressed Hayro bundle with HTTP Brotli so the browser supplies the original bytes before Hayro reads its Huffman tables. A worker-only Wasm import supplies bytes synchronously to the existing resolver on demand. Each deferred font is the exact Foxit file from the pinned release. Fixed asset IDs avoid interpreting document-supplied names as URLs.

The optional files total **433,210 B** in separate Brotli responses (CMaps + eleven fonts); a workload using them all pays for those bodies on top of the smaller core. They are deferred, not free. Synchronous requests serialize misses on a worker, so a page using many different deferred fonts can pay multiple request delays. The prototype caches requested fonts per worker and CMaps per Wasm instance. Before shipping, version, cache, integrity-check and deploy all sidecars with their license notices; evaluate slow/failing requests, cold rare-font pages and nested resources on target browsers, and prefer an asynchronous resolver interface upstream if available. No wider visual-compatibility or speed claim follows from this small corpus.

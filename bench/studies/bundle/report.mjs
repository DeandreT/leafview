import {readFileSync,writeFileSync} from "node:fs";
import {root} from "./profile.mjs";
const r=JSON.parse(readFileSync(`${root}/results/bundle-study.json`));
const vs=r.variants, base=vs.default, cur=vs.current, lazy=vs.lazy;
const fmt=v=>v.toLocaleString("en-US"), n=v=>fmt(Math.round(v));
const med=xs=>{xs=[...xs].sort((a,b)=>a-b);return (xs[(xs.length-1)>>1]+xs[xs.length>>1])/2};
const ms=(v,id)=>med(r.samples.filter(x=>x.variant===v&&x.id===id).map(x=>x.mainMs));
const jis=v=>med(r.namedCmapSamples.filter(x=>x.variant===v).map(x=>x.ms));
const renderer=(v)=>vs[v].brBytes+r.js.engine.brBytes+r.js[v==="lazy"?"lazyWorker":"worker"].brBytes;
const saved=renderer("current")-renderer("lazy"), pct=(a,b)=>(100*a/b).toFixed(1);
const frame=(v,id)=>r.quality.find(x=>x.variant===v&&x.id===id).frames[0];
const group=k=>r.symbols.groups[k]?.bodyBytes||0;
const jsDiff=r.js.lazyWorker.brBytes-r.js.worker.brBytes;
const coldGain=ms("current","p250")-ms("lazy","p250");
const adj=(v)=>v<0?`${n(-v)} ms slower`:`${n(v)} ms faster`;
const data=r.assets.find(a=>a.id===0),sum=r.assets.reduce((t,a)=>t+a.brBytes,0);
const rows=Object.entries(vs).map(([k,v])=>`| ${k} | ${n(v.rawBytes)} | ${n(v.sections.code)} | ${n(v.sections.data)} | ${n(v.brBytes)} | ${n(cur.brBytes-v.brBytes)} |`).join("\n");
const report=`# What can come out of the first download?

**The feature-preserving split saves ${n(saved)} Brotli bytes (${pct(saved,renderer("current"))}%) on the invoice path.** The real first 250-page preview changed from **${n(ms("current","p250"))} to ${n(ms("lazy","p250"))} ms** (${adj(coldGain)}). That ${saved>=400000?"clears":"falls short of"} 400,000 bytes${saved>=409600?" and 400 KiB":""}. Keep the three common invoice fonts in the module; load the other eleven Base-14 substitutes and the predefined CMap bundle when the renderer requests them. The unadorned feature switches do lose text.

## Pinned binary and actual feature builds

Wasm sections include section framing; Brotli is the **whole raw file compressed once at quality 11**, never a sum of compressed sections.

| WASM | Raw B | Code B | Data B | Brotli B | Brotli saved vs current B |
|---|---:|---:|---:|---:|---:|
${rows}

\`current\` is the shipped binary (${cur.sha256}); \`default\` is the clean staged release rebuild${base.sha256===cur.sha256?", SHA-256 identical":"; this rebuild differs from the published binary, so use the default row for feature marginal costs"}. The full module is ${pct(cur.sections.code,cur.rawBytes)}% code and ${pct(cur.sections.data,cur.rawBytes)}% data. \`fonts\` = embed-fonts only; \`cmaps\` = embed-cmaps only.

* Fonts cost **${n(base.brBytes-vs.cmaps.brBytes)} B** with CMaps enabled; **${n(vs.fonts.brBytes-vs.neither.brBytes)} B** without them.
* Predefined CMaps cost **${n(base.brBytes-vs.fonts.brBytes)} B** with fonts enabled; **${n(vs.cmaps.brBytes-vs.neither.brBytes)} B** without them.
* Dropping both is a **${n(base.brBytes-vs.neither.brBytes)} B** upper bound for feature deletion, not an acceptable general renderer. These differences include removed parsing/decompression code and changes to whole-file compression, not just embedded file lengths. Identity-H/V have explicit built-in fast paths; they alone cannot validate named CMap coverage.

### Decoder attribution

The default release has no symbol names. A companion full-feature build retains the name section; its noncustom sections ${r.symbols.matchedDefaultSections?"match the staged default byte for byte":"differ from the default, so treat the following as approximate"}. Counting function bodies with crate names present in their symbols gives **${n(group("hayro_jpeg2000"))} B JPEG 2000**, **${n(group("hayro_jbig2"))} B JBIG2**, **${n(group("zune_jpeg"))} B JPEG**, **${n(group("hayro_ccitt"))} B CCITT**, and **${n(group("brotli_decompressor"))} B Brotli decompressor**. These are raw code-body counts, with inlining, shared helpers and code folding by LTO; they are not removable Brotli bytes. Hayro-interpret pins hayro-syntax's \`images\` feature on, which pulls in all four PDF image decoders. This experiment leaves them enabled. See the [raw data](bundle-study.json) for section sizes, complete group counts and largest named functions.

## Real previews, cold paths and quality

| Scenario | Current median | Split median | Split outcome |
|---|---:|---:|---:|
| First, 250-page invoice packet | ${n(ms("current","p250"))} ms | ${n(ms("lazy","p250"))} ms | ${adj(coldGain)} |
| Next distinct 25-page packet, same tab | ${n(ms("current","p25"))} ms | ${n(ms("lazy","p25"))} ms | ${adj(ms("current","p25")-ms("lazy","p25"))} |
| Separate cold named-CMap fixture, engine render + frame | ${n(jis("current"))} ms | ${n(jis("lazy"))} ms | ${adj(jis("current")-jis("lazy"))} |

Each timing cell is the median of six fresh-context cases with order alternated in headless Chromium ${r.protocol.chromium}. Per-response delay 40 ms, 10 Mbit/s, 32 KiB chunks, no-store, static Brotli 11. Invoice timings use the unchanged host's open-to-main-canvas event after a rendering frame. The JIS case calls the production worker-backed engine directly and awaits the first animation frame. The 250-page PDF fetch overlaps the WASM fetch. The ordinary invoice packets made **zero** optional-resource requests; the next distinct open made zero additional WASM transfers. Bytes are encoded HTTP body bytes, excluding headers. All per-request logs and per-round timings are retained.

* First invoice renderer total (engine + worker + WASM): **${n(renderer("current"))} → ${n(renderer("lazy"))} B**. The main binary saves ${n(cur.brBytes-lazy.brBytes)} B; the worker costs ${n(jsDiff)} B more. The model gives a ${n((cur.brBytes-lazy.brBytes)/1250)} ms reduction in the longest response's transfer floor.
* Full 900px-wide RGBA hashes matched the current renderer for invoice pages 1 and 4, rotated page 3, scan page 2, a page using **every Base-14 font**, and JIS and Identity-H controls. The invoice title region had **${n(frame("current","p250").titleDark)}** dark pixels by default and **${frame("cmaps","p250")?.titleDark===undefined?"a render error":n(frame("cmaps","p250").titleDark)}** with fonts removed. The entire JIS text-only page had **${n(frame("current","jis").darkPixels)}** dark pixels by default and **${frame("fonts","jis")?.darkPixels===undefined?"a render error":n(frame("fonts","jis").darkPixels)}** without predefined CMaps. This is a stronger check than packet markers or page counts.
* The /H case encodes Greek ΩβΔ in JIS X 0208 with an embedded TrueType font and CID-to-GID mapping. An independently encoded /Identity-H document addressing the same CIDs produced identical pixels. Only the named-CMap page required the **${n(data.brBytes)} B** CMap body; Identity-H did not. The all-font sheet exercised the deferred font files. With an intentionally missing CMap sidecar, the worker returned an error and left the target canvas untouched.

## Shipping implications

This is a study prototype, reproducible with [the isolated build and browser scripts](../bench/studies/bundle/README.md). Both default resolvers and PDF decoder support are preserved. The CMap patch moves decompression outside Wasm: serve the decompressed Hayro bundle with HTTP Brotli so the browser supplies the original bytes before Hayro reads its Huffman tables. A worker-only Wasm import supplies bytes synchronously to the existing resolver on demand. Each deferred font is the exact Foxit file from the pinned release. Fixed asset IDs avoid interpreting document-supplied names as URLs.

The optional files total **${n(sum)} B** in separate Brotli responses (CMaps + eleven fonts); a workload using them all pays for those bodies on top of the smaller core. They are deferred, not free. Synchronous requests serialize misses on a worker, so a page using many different deferred fonts can pay multiple request delays. The prototype caches requested fonts per worker and CMaps per Wasm instance. Before shipping, version, cache, integrity-check and deploy all sidecars with their license notices; evaluate slow/failing requests, cold rare-font pages and nested resources on target browsers, and prefer an asynchronous resolver interface upstream if available. No wider visual-compatibility or speed claim follows from this small corpus.
`;
writeFileSync(`${root}/results/bundle-study.md`,report);

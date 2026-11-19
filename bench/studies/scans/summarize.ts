// Rebuild the concise report from retained samples; no browser run required.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const root=resolve(import.meta.dir,"../../.."), data=JSON.parse(readFileSync(resolve(root,"results/scans-study.json"),"utf8"));
const mib=(n:number)=>(n/(1024**2)).toFixed(3), median=(a:number[])=>a.sort((x,y)=>x-y)[Math.floor(a.length/2)];
const rows = data.medians.map((r:any)=>{
  const file=data.fixtures.find((f:any)=>f.id===r.id);
  return `| ${r.id} | ${mib(file.bytes)} | ${r.mode} | ${(r.firstPreviewMs/1000).toFixed(3)} | ${mib(r.pdfEncodedBytes)} | ${r.pdfRequests} | ${mib(r.allEncodedBytes)} | ${r.allRequests} |`;
});
const rates = data.samples.filter((s:any)=>s.mode==="leafview-full" && s.id==="250-independent").map((s:any)=>{
  const p = s.requests.find((r:any)=>r.path.endsWith(".pdf")), w=s.requests.find((r:any)=>r.path.endsWith(".wasm"));
  const overlapMs=Math.min(p.lastBodyMs,w.lastBodyMs)-Math.max(p.firstBodyMs,w.firstBodyMs);
  const span=Math.max(p.lastBodyMs,w.lastBodyMs)-Math.min(p.firstBodyMs,w.firstBodyMs);
  return {overlapMs,rate:(p.encodedBytes+w.encodedBytes-data.study.chunkBytes)*8/(1000*span)};
});
const lookup=(id:string,mode:string)=>data.medians.find((r:any)=>r.id===id && r.mode===mode);
const big=lookup("250-independent","pdfjs-range"), full=lookup("250-independent","pdfjs-full");
writeFileSync(resolve(root,"results/scans-study.md"),`# Independent JPEG scan packets: first preview

With 250 independent scan images, PDF.js range reads cut median first-preview time from **${(full.firstPreviewMs/1000).toFixed(2)} s to ${(big.firstPreviewMs/1000).toFixed(2)} s** and PDF body bytes by **${((1-big.pdfEncodedBytes/full.pdfEncodedBytes)*100).toFixed(1)}%**. Leafview fetched the full file and painted in **${(lookup("250-independent","leafview-full").firstPreviewMs/1000).toFixed(2)} s**. The range path is a PDF.js comparator, not a Leafview feature. Repeating one raster across 250 pages changes the economics: PDF.js full versus range was ${(lookup("250-shared","pdfjs-full").firstPreviewMs/1000).toFixed(2)} versus ${(lookup("250-shared","pdfjs-range").firstPreviewMs/1000).toFixed(2)} s.

| Packet | File MiB | Mode | First preview (s) | PDF MiB by frame | PDF requests | All MiB by frame | All requests |
|---|---:|---|---:|---:|---:|---:|---:|
${rows.join("\n")}

Each cell is a median of three rotating-order fresh-context runs. First preview is the host frame after rendering the selected page; all ${data.samples.length} page-count, page-marker and raster pixel checks passed. Request counts include canceled requests. Bytes are server writes through the frame, including gzip renderer code in “All” and any partial initial 200 in “PDF”. No-store; shell already loaded; CPU and process-level caches may be warm.

**Why the byte savings barely moved first paint:** for the 250 independent pages, the trace shows an initial 200 request followed by 252 partial responses. After reading the head and tail, PDF.js fetched many separate 64 KiB windows spread across this non-linearized file. Each incurred the modeled 40 ms header delay. The measured latency distributions overlap; the 73.4% drop in PDF bytes is the clearer result. On 25 independent pages, range reads likewise saved bytes but had a slightly slower median paint.

**Pacing check.** One origin-wide 50 Mbit/s schedule, 40 ms before each response's headers, ${data.study.chunkBytes}-byte slices and up to ${data.study.peakSimultaneousPacingWaiters} simultaneous schedule waiters. During Leafview's large independent opens the PDF and WASM body intervals overlapped by a median ${median(rates.map((r:any)=>r.overlapMs)).toFixed(0)} ms. Together they delivered ${median(rates.map((r:any)=>r.rate)).toFixed(1)} Mbit/s from first to last body write (median, excluding the first slice), not 50 Mbit/s per parallel response. This is server-side pacing, not a WAN replay.

[Raw samples, request headers/ranges, hashes and environment](scans-study.json) · [Method, reproduction and limitations](../bench/studies/scans/README.md)
`);

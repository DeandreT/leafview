import { chromium } from "playwright";
import { createServer, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cpus, release } from "node:os";
import { gzipSync } from "node:zlib";
import { fixtures, hash, key, marker } from "./fixtures";

if (process.platform === "win32" && process.env.LEAFVIEW_SCAN_MUTEX !== "held") throw Error("Use run.ps1");
const root = resolve(import.meta.dir,"../../.."), version = (name:string)=>JSON.parse(readFileSync(resolve(root,"node_modules",name,"package.json"),"utf8")).version;
const modes = ["leafview-full","pdfjs-full","pdfjs-range"] as const;
type Mode = typeof modes[number];
type Transfer = {path:string, range:string|null,status:number, length:number, contentRange:string|null, t:number, writes:[number,number][]};
let active: {id:string, mode:Mode, logs:Transfer[]} | null = null;
const now = () => performance.timeOrigin + performance.now();
const assets = new Map<string,Buffer>(), assetManifest: any[] = [];
function asset(path:string,mode:Mode) {
  const name = path === "/" ? "/index.html" : path;
  const ident = name === "/pdfjs-engine.js" ? `${name}#${mode}` : name;
  if (assets.has(ident)) return assets.get(ident)!;
  const base = name.startsWith("/pdfjs/") ? `${root}/node_modules/pdfjs-dist/${name.slice(7)}` : `${root}/web${name}`;
  let b = readFileSync(base);
  if (name === "/pdfjs-engine.js") {
    const source = b.toString();
    if (!source.includes("getDocument({ url,")) throw Error("Adapter changed");
    b = Buffer.from(source.replace("getDocument({ url,", `getDocument({ url, disableRange:${mode === "pdfjs-full"}, disableStream:true, disableAutoFetch:true, rangeChunkSize:65536,`));
  }
  const encoded = gzipSync(b,{level:9}); assets.set(ident,encoded);
  assetManifest.push({asset:ident,rawBytes:b.length,sha256:hash(b),gzipBytes:encoded.length});
  return encoded;
}
// One shared byte clock for the entire origin, FIFO one pending 32 KiB slice per
// response. Overlapping requests don't multiply bandwidth. Discard accrued idle
// credit, but don't accumulate timer rounding for back-to-back slices.
const bytesPerMs = 6250, chunk = 32768, delay = 40;
let nextSlot = performance.now(), pending = 0, peakPending = 0;
async function send(res:ServerResponse,b:Buffer,log:Transfer) {
  await Bun.sleep(delay);
  if (res.destroyed) return;
  res.flushHeaders();
  for (let i = 0; i < b.length;) {
    const end = Math.min(i+chunk,b.length), n = end-i;
    nextSlot = Math.max(performance.now()-1,nextSlot) + n/bytesPerMs;
    pending++; peakPending=Math.max(peakPending,pending);
    await Bun.sleep(Math.max(0, Math.ceil(nextSlot-performance.now())));
    pending--;
    if (res.destroyed) return;
    if (end === b.length) res.end(b.subarray(i,end)); else res.write(b.subarray(i,end));
    log.writes.push([now(),n]); i=end;
  }
}
const browser = await chromium.launch();
try {
  const {docs,metadata} = await fixtures(browser);
  console.log("Fixtures:",metadata.map(x=>[x.id,x.bytes]));
  for (const mode of modes) for (const path of ["/","/host.js", ...(mode==="leafview-full" ?
    ["/wasm-engine.js","/wasm-worker.js","/pkg/folio_wasm.wasm"] : ["/pdfjs-engine.js","/pdfjs/build/pdf.min.mjs","/pdfjs/build/pdf.worker.min.mjs"])]) asset(path,mode);
  const server = createServer(async (req,res)=>{
    try {
      const path = new URL(req.url!,"http://localhost").pathname;
      const s = active;
      if (!s || !/^(?:\/|\/(?:host|wasm-engine|wasm-worker|pdfjs-engine)\.js|\/pkg\/folio_wasm\.wasm|\/pdfjs\/(?:build\/pdf(?:\.worker)?\.min\.mjs|wasm\/[a-z0-9_.-]+)|\/fixtures\/p(?:25|250)\.pdf)$/.test(path)) {res.writeHead(404).end();return;}
      const pdf = path.startsWith("/fixtures/"), range = req.headers.range || null;
      let b = pdf ? docs.get(s.id)! : asset(path,s.mode), contentRange:string|null = null;
      const type = pdf ? "application/pdf" : path === "/" ? "text/html" : path.endsWith(".wasm") ? "application/wasm" : "text/javascript";
      let status = 200;
      if (pdf && range) {
        const m = /^bytes=(\d+)-(\d*)$/.exec(range), first = Number(m?.[1]), last = m?.[2] ? Math.min(Number(m[2]),b.length-1) : b.length-1;
        if (!m || first >= b.length || first > last) {res.writeHead(416,{"Content-Range":`bytes */${b.length}`}).end();return;}
        contentRange=`bytes ${first}-${last}/${b.length}`; b = b.subarray(first,last+1); status=206;
      }
      res.writeHead(status,{"Cache-Control":"no-store","Content-Type":type,"Content-Length":b.length,
        ...(pdf ? {"Accept-Ranges":"bytes","Content-Encoding":"identity"} : {"Content-Encoding":"gzip"}),
        ...(contentRange ? {"Content-Range":contentRange} : {})});
      const log:Transfer = {path,range,status,length:b.length,contentRange,t:now(),writes:[]};
      s.logs.push(log);
      await send(res,b,log);
    } catch (e) { console.error("HTTP:",e); res.destroy(); }
  });
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const samples:any[] = [], rounds=3, viewport={width:1440,height:900};
  try {
    for (let r=0;r<rounds;r++) for (const n of r%2 ? [250,25] : [25,250]) for (const independent of r%2 ? [true,false] : [false,true]) {
      for (let mi=0;mi<modes.length;mi++) {
        const mode=modes[(mi+r)%3], id=key(n,independent), docId=`p${n}`;
        const ctx=await browser.newContext({viewport,deviceScaleFactor:1});
        const state = active = {mode,id,logs:[] as Transfer[]};
        try {
          const p = await ctx.newPage();
          await p.goto(`${origin}/?engine=${mode==="leafview-full" ? "wasm" : "pdfjs"}`);
          await p.waitForFunction(()=>!!(window as any).bench);
          const t = await p.evaluate(id=>{const t=performance.now();(window as any).bench.open(id);return t;},docId);
          const h=await p.waitForFunction(({docId,red,n})=>{
            const b=(window as any).bench, st=b.status(), ev=b.events.find((e:any)=>!e.thumb && e.page===1 && e.id===docId);
            if (st.failure) throw Error(st.failure);
            if (!ev) return false;
            const c=document.querySelector("#main-preview canvas") as HTMLCanvasElement;
            const g=c.getContext("2d")!, px=(x:number,y:number)=>[...g.getImageData(Math.floor(x*c.width),Math.floor(y*c.height),1,1).data];
            const m=px(7/8,1/8), dark=px(.07,.066), paper=px(.04,.04);
            if (st.pageCount!==n || c.width!==900 || Math.abs(m[0]-red)>4 || Math.abs(m[1]-16)>4 || Math.abs(m[2]-16)>4 ||
              dark[0]>60 || paper[0]<190 || m[3]!==255) throw Error(`Invalid raster or marker: ${JSON.stringify({m,dark,paper,st})}`);
            return {frame:ev.t,origin:performance.timeOrigin,m,dark,paper};
          },{docId,red:marker(n,independent),n},{timeout:120000});
          const result = await h.jsonValue() as any, start=result.origin+t, paint=result.origin+result.frame;
          const reqs=state.logs.filter(l=>!(["/","/host.js"].includes(l.path)) && l.t<=paint).map(l=>({
            path:l.path,requestRange:l.range,status:l.status,contentRange:l.contentRange,contentLength:l.length,
            requestedMs:+(l.t-start).toFixed(2), encodedBytes:l.writes.filter(([at])=>at<=paint).reduce((a,[_,n])=>a+n,0),
            firstBodyMs:l.writes.length ? +(l.writes[0][0]-start).toFixed(2) : null,
            lastBodyMs:l.writes.some(([at])=>at<=paint) ? +(l.writes.filter(([at])=>at<=paint).at(-1)![0]-start).toFixed(2) : null}));
          const pdfs=reqs.filter(x=>x.path.startsWith("/fixtures/")), bytes=(a:typeof reqs)=>a.reduce((s,x)=>s+x.encodedBytes,0), pdfBytes=bytes(pdfs);
          if (!pdfs.length || (mode === "pdfjs-range" ? !pdfs.some(x=>x.status===206 && x.encodedBytes>0) :
            pdfs.length!==1 || pdfs[0].status!==200 || pdfBytes!==docs.get(id)!.length)) throw Error(`Incorrect transport: ${JSON.stringify(pdfs)}`);
          samples.push({round:r+1,mode,id,firstPreviewMs:+(result.frame-t).toFixed(2),pdfEncodedBytes:pdfBytes,pdfRequests:pdfs.length,
            allEncodedBytes:bytes(reqs),allRequests:reqs.length,verifiedPixels:{marker:result.m,rasterInk:result.dark,paper:result.paper},requests:reqs});
          console.log(r+1,id,mode,samples.at(-1).firstPreviewMs,pdfBytes);
        } finally { await ctx.close(); active=null; }
      }
    }
    const med=(a:number[])=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
    const medians=metadata.flatMap(f=>modes.map(mode=>{
      const rows=samples.filter(s=>s.id===f.id && s.mode===mode);
      return {id:f.id,mode,...Object.fromEntries(["firstPreviewMs","pdfEncodedBytes","pdfRequests","allEncodedBytes","allRequests"].map(k=>[k,med(rows.map(s=>s[k]))]))};
    }));
    writeFileSync(resolve(root,"results/scans-study.json"),JSON.stringify({generatedAt:new Date().toISOString(),
      machine:{cpu:cpus()[0]?.model,os:process.platform,release:release(),arch:process.arch,chromium:browser.version(),bun:Bun.version,pdfjs:version("pdfjs-dist"),playwright:version("playwright")},
      study:{rounds,viewport,dpr:1,requestDelayMs:delay,aggregateMbitPerSecond:50,peakSimultaneousPacingWaiters:peakPending,chunkBytes:chunk,
        pdfEncoding:"identity",assetEncoding:"gzip-9",pdfjsRangeChunkBytes:65536,disableStream:true,disableAutoFetch:true,
        metric:"Open in a loaded shell to host's first main-render rAF. Encoded body bytes written by the server by that timestamp; excludes HTTP headers, shell, transport overhead. Fresh context per sample."},
      fixtures:metadata,assetManifest,medians,samples},null,2)+"\n");
  } finally { server.closeAllConnections(); server.close(); }
} finally { await browser.close(); }

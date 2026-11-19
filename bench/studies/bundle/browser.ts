import {chromium} from "playwright";
import {readFileSync as read, writeFileSync as write} from "node:fs";
import {cpus,release} from "node:os";
import {verifyCanvas} from "../../markers.ts";
import {encode} from "../../../scripts/precompress.mjs";
import {root,stage,sha} from "./profile.mjs";
import {fixtures} from "./fixtures.mjs";
const profile=JSON.parse(read(`${stage}/profile.json`,"utf8"));
const variants=["current","fonts","cmaps","neither","lazy"] as const;
type Variant=typeof variants[number];
const entries=new Map<string,Buffer>(), hashes={};
function wire(key:string,b:Buffer){entries.set(key,encode(b).br);hashes[key]=sha(b)}
for(const path of ["index.html","host.js","wasm-engine.js","wasm-worker.js"])wire("/"+path,read(`${root}/web/${path}`));
wire("lazy-worker",read(`${stage}/lazy-worker.js`));
for(const v of variants)entries.set(v,read(`${stage}/${v}.br`));
for(const a of profile.assets) entries.set(`/resources/${a.id}.bin`,read(`${stage}/lazy-assets/${a.id}.br`));
for(const id of ["p250","p25"]) wire(`/fixtures/${id}.pdf`,read(`${root}/fixtures/${id}.pdf`));
for(const [key,b] of Object.entries(fixtures(root)))wire(`/fixtures/${key}.pdf`,b as Buffer);
let variant:Variant="current",paced=false, unavailableCmap=false;
let log:{path:string,bytes:number}[]=[];
const server=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(req){
  const path=new URL(req.url).pathname;
  if(unavailableCmap && path==="/resources/0.bin") return new Response(null,{status:404});
  const key=path==="/pkg/folio_wasm.wasm"?variant:path==="/wasm-worker.js" && variant==="lazy"?"lazy-worker":path==="/" ? "/index.html":path;
  const b=entries.get(key);
  if(!b)return new Response(null,{status:404});
  const type=path.endsWith(".js")?"text/javascript":path.endsWith(".wasm")?"application/wasm":path.endsWith(".pdf")?"application/pdf":path.endsWith(".bin")?"application/octet-stream":"text/html";
  if(!req.headers.get("accept-encoding")?.includes("br"))throw Error("Brotli unsupported");
  const rec={path,bytes:0};log.push(rec);
  const headers={"Content-Type":type,"Content-Encoding":"br","Content-Length":b.length.toString(),"Cache-Control":"no-store","Vary":"Accept-Encoding"};
  if(!paced){rec.bytes=b.length;return new Response(b,{headers})}
  const t=performance.now();let p=0;await Bun.sleep(40);
  return new Response(new ReadableStream({async pull(c){
    const end=Math.min(p+32768,b.length);await Bun.sleep(Math.max(0,Math.ceil(t+40+end/1250-performance.now())));
    c.enqueue(b.subarray(p,end));rec.bytes+=end-p;p=end;if(end===b.length)c.close();
  }}),{headers});
}});
const viewport={width:1440,height:900}, rounds=6;
const quality:any[]=[],samples:any[]=[],namedCmapSamples:any[]=[];
const b=await chromium.launch();
try{
  for(const v of variants){
    variant=v;
    const ctx=await b.newContext({viewport});
    try{
      const p=await ctx.newPage();await p.goto(server.url.href);
      for(const [id,pages] of [["p250",[1,2,3,4]],["base14",[1]],["jis",[1]],["identity",[1]]] as const){
        log=[];
        const frames=await p.evaluate(async({id,pages})=>{
          const engine=await import("/wasm-engine.js"), doc=await engine.openDocument(`/fixtures/${id}.pdf`), result=[];
          try{for(const page of pages){
            const c=document.createElement("canvas");await doc.render(page,900,c);
            const ctx=c.getContext("2d")!,{data}=ctx.getImageData(0,0,c.width,c.height);
            const digest=async(d:Uint8ClampedArray)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",d)),x=>x.toString(16).padStart(2,"0")).join("");
            let dark=0;for(let i=0;i<data.length;i+=4)if(data[i]<160&&data[i+1]<160&&data[i+2]<160)dark++;
            // The first invoice title sits above all table rules and left of the marker.
            const roi=ctx.getImageData(50,55,460,60).data;let titleDark=0;for(let i=0;i<roi.length;i+=4)if(roi[i]<160)titleDark++;
            result.push({page,width:c.width,height:c.height,darkPixels:dark,titleDark,rgbaSha256:await digest(data)});
          }}finally{doc.destroy()}
          return result;
        },{id,pages}).catch(err=>{
          // A feature-deletion build may legitimately trap; never permit in baseline or lazy.
          if(v==="current"||v==="lazy")throw err;
          return {error:String(err)};
        });
        quality.push({variant:v,id,frames,resources:log.filter(x=>x.path.startsWith("/resources/"))});
      }
    }finally{await ctx.close()}
  }
  const frames=(v:string,id:string)=>quality.find(x=>x.variant===v&&x.id===id).frames;
  const hashesFor=(v:string,id:string)=>frames(v,id).map(x=>x.rgbaSha256).join(",");
  for(const id of ["p250","jis","identity","base14"]){
    if(hashesFor("lazy",id)!==hashesFor("current",id))throw Error(`Split changes pixels for ${id}`);
  }
  if(hashesFor("current","jis")!==hashesFor("current","identity")||frames("current","jis")[0].darkPixels<100)throw Error("JIS control invalid");
  // Ensure a missing sidecar cannot silently publish a degraded preview.
  variant="lazy";unavailableCmap=true;
  let missingAsset;
  const failCtx=await b.newContext({viewport});
  try{
    const p=await failCtx.newPage();await p.goto(server.url.href);
    missingAsset=await p.evaluate(async()=>{
      const engine=await import("/wasm-engine.js"),doc=await engine.openDocument("/fixtures/jis.pdf");
      const c=document.createElement("canvas");c.width=1;c.height=1;
      try{await doc.render(1,900,c);return {error:null,width:c.width}}catch(e){return {error:String(e),width:c.width}}
      finally{doc.destroy()}
    });
    if(!missingAsset.error?.includes("Invalid renderer asset")||missingAsset.width!==1)throw Error("Sidecar failure did not fail closed");
  }finally{unavailableCmap=false;await failCtx.close()}
  paced=true;
  for(let round=1;round<=rounds;round++){
    for(const v of (round%2?["current","lazy"]:["lazy","current"]) as Variant[]){
      variant=v;
      const ctx=await b.newContext({viewport,deviceScaleFactor:1});
      try{
        const p=await ctx.newPage();await p.addInitScript(`window.verifyCanvas = (${verifyCanvas.toString()});`);
        await p.goto(server.url.href+"?engine=wasm");await p.waitForFunction(()=>!!window.bench);
        for(const id of ["p250","p25"]){
          log=[];
          const from=await p.evaluate(id=>{const t=performance.now();window.bench.open(id);return t;},id);
          const h=await p.waitForFunction(({from,id})=>{
            const b=window.bench;if(b.status().failure)throw Error(b.status().failure);
            const e=b.events.find(e=>e.t>=from&&e.id===id&&!e.thumb&&e.page===1);
            if(!e)return false;if(!window.verifyCanvas(document.querySelector("#main-preview canvas"),1,id))throw Error("Bad pixels");
            return e.t-from;
          },{from,id},{timeout:90000});
          const mainMs=await h.jsonValue();await h.dispose();
          await p.waitForFunction(()=>{const s=window.bench.status();if(s.failure)throw Error(s.failure);return !s.busy&&s.mainReady&&s.painted>0&&s.painted===s.visible;});
          const wireBytes=await p.evaluate(()=>performance.getEntriesByType("resource").filter(x=>new URL(x.name).pathname.endsWith(".wasm")).map(x=>x.encodedBodySize));
          if(wireBytes.length!==1 || wireBytes[0]!==entries.get(v)!.length ||
            log.filter(x=>x.path.endsWith(".wasm")).length!==Number(id==="p250") || log.some(x=>x.path.startsWith("/resources/")))throw Error("Unexpected fetches");
          const wasm=log.find(x=>x.path.endsWith(".wasm"));if(wasm&&wasm.bytes!==wireBytes[0])throw Error("Body count mismatch");
          samples.push({round,variant:v,id,mainMs,marker:true,wasmBytes:wasm?.bytes??0,transfers:log});
        }
      }finally{await ctx.close()}
    }
  }
  // Separate stress case: a first document actually consumes the CMap sidecar.
  // Use the production engine/worker but call render() directly (host IDs are restricted).
  for(let round=1;round<=rounds;round++) for(const v of (round%2?["current","lazy"]:["lazy","current"]) as Variant[]){
    variant=v; const ctx=await b.newContext({viewport,deviceScaleFactor:1});
    try{
      const p=await ctx.newPage();await p.goto(server.url.href);log=[];
      const {ms,rgbaSha256}=await p.evaluate(async()=>{
        const t=performance.now(), engine=await import("/wasm-engine.js"), doc=await engine.openDocument("/fixtures/jis.pdf");
        try{
          const c=document.createElement("canvas");document.body.replaceChildren(c);
          await doc.render(1,900,c);await new Promise(requestAnimationFrame);
          const ms=performance.now()-t;
          const data=c.getContext("2d")!.getImageData(0,0,c.width,c.height).data;
          const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",data));
          return {ms,rgbaSha256:Array.from(digest,x=>x.toString(16).padStart(2,"0")).join("")};
        }finally{doc.destroy()}
      });
      if(rgbaSha256!==frames("current","identity")[0].rgbaSha256)throw Error("Bad paced CMap glyphs");
      namedCmapSamples.push({round,variant:v,ms,rgbaSha256,transfers:log});
    }finally{await ctx.close()}
  }
  write(`${root}/results/bundle-study.json`,JSON.stringify({generatedAt:new Date().toISOString(),...profile,
    quality,missingAsset,samples,namedCmapSamples,hashes,protocol:{rounds,viewport,deviceScaleFactor:1,mbitPerResponse:10,delayMs:40,chunkBytes:32768,brotliQuality:11,bun:Bun.version,
      chromium:b.version(),playwright:JSON.parse(read(`${root}/node_modules/playwright/package.json`)).version,
      cpu:cpus()[0]?.model,osRelease:release()}},null,2)+"\n");
}finally{await b.close();server.stop(true)}

import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { bitmapModules } from "./adapters.mjs";

if (process.platform !== "win32" || Number(process.env.LEAFVIEW_CANVAS_LOCK_OWNER) !== process.ppid)
  throw Error("Use pwsh -File bench/studies/canvas/run.ps1 (shared browser mutex)");
const root = new URL("../../../",import.meta.url), local = new URL("./",import.meta.url);
const get = f => readFile(new URL(f,root));
const wasm = await get("web/pkg/folio_wasm.wasm"), pdf = await get("fixtures/p25.pdf");
const source = {engine:(await get("web/wasm-engine.js")).toString(),worker:(await get("web/wasm-worker.js")).toString()};
const adapted = bitmapModules(source.engine,source.worker);
const html = "<!doctype html><title>Canvas presentation study</title><style>body{margin:0}</style><script src=/page.js defer></script>";
const routes = new Map([["/",[html,"text/html"]],["/page.js",[await readFile(new URL("page.js",local)),"text/javascript"]],
  ["/fixtures/p25.pdf",[pdf,"application/pdf"]]]);
for (const [mode,code] of [["baseline",source],["bitmap",adapted]]) {
  routes.set(`/${mode}/wasm-engine.js`,[code.engine,"text/javascript"]);
  routes.set(`/${mode}/wasm-worker.js`,[code.worker,"text/javascript"]);
  routes.set(`/${mode}/pkg/folio_wasm.wasm`,[wasm,"application/wasm"]);
}
const server = Bun.serve({hostname:"127.0.0.1", port:0, fetch(req) {
  const route = routes.get(new URL(req.url).pathname);
  if (!route) return new Response(null,{status:404});
  return new Response(route[0],{headers:{"Content-Type":route[1],"Content-Length":String(Buffer.byteLength(route[0]))}});
}});
const url = server.url.toString();
const sha = x=>createHash("sha256").update(x).digest("hex");
const pages = [1,2,3,4,5,8,2,1,5,3,4,8], rounds = 6;
const data = {generatedAt:new Date().toISOString(), windows:os.release(),cpu:os.cpus()[0].model,
  ramBytes:os.totalmem(), bun:Bun.version, playwright:JSON.parse(await get("node_modules/playwright/package.json")).version,
  chromium:null, sha256:{wasm:sha(wasm),pdf:sha(pdf),engine:sha(source.engine),worker:sha(source.worker),
    bitmapEngine:sha(adapted.engine),bitmapWorker:sha(adapted.worker)}, widths:[900,1600], rounds, pages,
  runs:[], equivalence:[]};
async function processList(cdp) {
  return (await cdp.send("SystemInfo.getProcessInfo")).processInfo.map(p=>({pid:p.id,type:p.type})).sort((a,b)=>a.pid-b.pid);
}
async function sampler(ids) {
  // Windows Bun subprocess stdio need not deliver partial lines. A single-use
  // temp directory provides a bounded handshake and a completed JSON result.
  const dir = await mkdtemp(join(os.tmpdir(),"leafview-canvas-"));
  let child;
  async function cleanup() {
    try {
      if (child && child.exitCode === null) child.kill();
      if (child) await child.exited;
    } finally { await rm(dir,{recursive:true,force:true}); }
  }
  async function waitFor(test, label) {
    const until = performance.now()+10000;
    while (!(await test())) {
      if (child.exitCode !== null || performance.now()>until) throw Error(`Sampler ${label}: exit=${child.exitCode}`);
      await Bun.sleep(5);
    }
  }
  try {
    child = Bun.spawn(["python","-u",fileURLToPath(new URL("sample.py",local)),dir,...ids.map(p=>String(p.pid))],
      {stdin:"ignore",stdout:"ignore",stderr:"inherit"});
    await waitFor(()=>Bun.file(join(dir,"ready")).exists(),"start");
    return async () => {
      try {
        await writeFile(join(dir,"stop"),"");
        await waitFor(()=>child.exitCode !== null,"stop");
        if (child.exitCode !== 0) throw Error(`Sampler failed (${child.exitCode})`);
        return await Bun.file(join(dir,"result.json")).json();
      } finally { await cleanup(); }
    };
  } catch(e) { await cleanup(); throw e; }
}
async function run(round,width,mode) {
  const browser = await chromium.launch();
  let endSample;
  try {
    data.chromium = browser.version();
    const tab = await browser.newPage({viewport:{width:960,height:900},deviceScaleFactor:1});
    const cdp = await browser.newBrowserCDPSession();
    await tab.goto(url);
    const clock = await tab.evaluate(mode=>window.init(mode),mode);
    const draw = n=>tab.evaluate(([p,w])=>window.draw(p,w),[n,width]);
    // Warm all page types and compositor before fixing PID set. Memory is
    // sampled for precisely the ensuing sequence, excluding hash/screenshot.
    for (const p of [1,2,3]) await draw(p);
    const ids = await processList(cdp);
    endSample = await sampler(ids);
    const samples = [];
    // Rotate by pairs across rounds; use exactly the same order for both arms.
    for (let j=0;j<pages.length;j++) samples.push(await draw(pages[(j+2*(round-1))%pages.length]));
    const finish = endSample; endSample = null;
    const memory = await finish();
    if (JSON.stringify(ids)!==JSON.stringify(await processList(cdp))) throw Error("Chromium process set changed");
    data.runs.push({round,mode,width,clock,processes:ids,memory,samples});
    if(round===1) {
      for(const page of new Set(pages)) {
        const check = await tab.evaluate(([p,w])=>window.fingerprint(p,w),[page,width]);
        const clip = await tab.evaluate(()=>window.markerClip());
        const base64 = (await tab.screenshot({clip, timeout:15000})).toString("base64");
        check.screenshotMarker = await tab.evaluate(arg=>window.screenshotMarker(arg),{base64,page});
        data.equivalence.push({mode,...check});
      }
    }
    await tab.evaluate(()=>window.done());
    console.log(`Round ${round}/${rounds} ${width} ${mode}: ${samples.length} verified, peak ${(memory.peakBytes/2**20).toFixed(1)} MiB`);
  } finally {
    try { if(endSample) await endSample(); } finally { await browser.close(); }
  }
}
function stats(values) {
  values.sort((a,b)=>a-b);
  const n = values.length;
  return {n, median:(values[(n-1)>>1]+values[n>>1])/2, p95:values[Math.ceil(n*.95)-1],max:values[n-1]};
}
try {
  for (let round=1;round<=rounds;round++) {
    for (const width of round%2 ? data.widths : [...data.widths].reverse()) {
      for (const mode of round%2 ? ["baseline","bitmap"] : ["bitmap","baseline"]) await run(round,width,mode);
    }
  }
  for (const a of data.equivalence.filter(s=>s.mode==="baseline")) {
    const b=data.equivalence.find(s=>s.mode==="bitmap"&&s.page===a.page&&s.width===a.width);
    if(!b || a.height!==b.height || a.sha256!==b.sha256) throw Error(`Frame mismatch: ${JSON.stringify(a)}`);
  }
  data.summary = [];
  for(const width of data.widths) for(const mode of ["baseline","bitmap"]) {
    const runs = data.runs.filter(r=>r.width===width && r.mode===mode);
    const samples = runs.flatMap(r=>r.samples);
    const timing = Object.fromEntries(["renderMs","afterFrameMs","verifiedMs","mainSubmitMs"].map(k=>[k,stats(samples.map(s=>s[k]))]));
    data.summary.push({width,mode,...timing, peakMiB:stats(runs.map(r=>r.memory.peakBytes/2**20))});
  }
  await writeFile(new URL("results/canvas-study.json",root),JSON.stringify(data,null,2)+"\n");
} finally {await server.stop(true);}

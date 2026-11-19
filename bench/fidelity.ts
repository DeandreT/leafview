// Independent of host scheduling: compare full pages to catch missing text or images.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { verifyCanvas } from "./markers";

const root = resolve(".");
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
  const path = new URL(req.url).pathname;
  if (path === "/") return new Response("<!doctype html><title>Pixel comparison</title>", {headers: {"Content-Type":"text/html"}});
  if (!["/node_modules/pdfjs-dist/", "/web/", "/fixtures/"].some(x => path.startsWith(x))) return new Response(null,{status:404});
  const name = resolve(root, "." + path);
  if (!name.startsWith(root + sep)) return new Response(null,{status:403});
  const file = Bun.file(name);
  return await file.exists() ? new Response(file) : new Response(null,{status:404});
}});
try {
  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage();
    await tab.goto(server.url.toString());
    await tab.addScriptTag({content:`window.check = (${verifyCanvas.toString()});`});
    const samples = await tab.evaluate(async () => {
      const js = await import("/node_modules/pdfjs-dist/build/pdf.mjs");
      js.GlobalWorkerOptions.workerSrc = "/node_modules/pdfjs-dist/build/pdf.worker.mjs";
      const url = "/fixtures/p25.pdf";
      const pdf = await js.getDocument({url, standardFontDataUrl:"/node_modules/pdfjs-dist/standard_fonts/"}).promise;
      const wasm = await (await import("/web/wasm-engine.js")).openDocument(url);
      try {
        const cases = [];
        for (const n of [1,2,3,24,25]) {
          const p = await pdf.getPage(n), width = 900;
          const v = p.getViewport({scale:width / p.getViewport({scale:1}).width});
          const a = document.createElement("canvas"), b = document.createElement("canvas");
          a.width = v.width; a.height = v.height;
          await p.render({canvas:a, viewport:v}).promise;
          await wasm.render(n,width,b);
          const marks = [a,b].every(c => (window as any).check(c,n,"p25"));
          const sizes = [[a.width,a.height],[b.width,b.height]];
          // Allow a single pixel of rounding, but no change in orientation.
          const dimensions = Math.abs(a.width-b.width)<=1 && Math.abs(a.height-b.height)<=1;
          const cells = (canvas: HTMLCanvasElement) => {
            const {width:w,height:h} = canvas;
            const pixels = canvas.getContext("2d")!.getImageData(0,0,w,h).data;
            const ink = new Float64Array(32*32);
            let clear = 0;
            for (let y=1;y<h;y+=2) for (let x=1;x<w;x+=2) {
              const i=4*(y*w+x);
              if (pixels[i+3] !== 255) ++clear;
              ink[Math.floor(32*y/h)*32+Math.floor(32*x/w)] += 765-pixels[i]-pixels[i+1]-pixels[i+2];
            }
            return {ink,clear};
          };
          const left = cells(a), right = cells(b);
          let min=0,max=0;
          for(let i=0;i<left.ink.length;i++){
            min+=Math.min(left.ink[i],right.ink[i]);max+=Math.max(left.ink[i],right.ink[i]);
          }
          cases.push({page:n, sizes, dimensions, marks, opaque:!(left.clear||right.clear), tileInkOverlap:min/Math.max(1,max)});
        }
        return cases;
      } finally { await wasm.destroy(); await pdf.destroy(); }
    });
    await mkdir("results",{recursive:true});
    await writeFile("results/fidelity.json",JSON.stringify(samples,null,2)+"\n");
    console.log(samples);
    if(samples.some(s=>!s.dimensions || !s.marks || !s.opaque || s.tileInkOverlap<0.75)) throw Error("visual checkpoint failed");
  } finally { await browser.close(); }
} finally {server.stop(true);}

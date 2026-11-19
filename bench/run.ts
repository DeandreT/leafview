// bun bench/run.ts [output.json] | --smoke [pdfjs|wasm] | --serve
import { chromium, type Browser, type Page } from "playwright";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, release, totalmem } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { verifyCanvas } from "../bench/markers.ts";

const root = resolve(import.meta.dir, "..");
const rounds = Number(process.env.BENCH_ROUNDS ?? 6);
if (!Number.isSafeInteger(rounds) || rounds < 1) throw Error("Invalid BENCH_ROUNDS");
const viewport = { width: 1440, height: 900 };
const engines = ["pdfjs", "wasm"] as const;
type Engine = typeof engines[number];
const smoke = process.argv[2] === "--smoke";
const paced = process.argv[2] === "--paced";
const wireCache = new Map<string, Buffer>();
const output = resolve(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : `${root}/artifacts/results.json`);
const assets = { pdfjs: new Map<string, string>(), wasm: new Map<string, string>() };
let measuring: Engine | undefined;
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (!/^\/[a-z0-9./_-]*$/i.test(path)) return new Response(null, { status: 400 });
    const vendor = path.startsWith("/pdfjs/"), fixture = path.startsWith("/fixtures/");
    const base = resolve(root, vendor ? "node_modules/pdfjs-dist" : fixture ? "fixtures" : "web");
    const file = resolve(base, "." + (vendor ? path.slice(6) : fixture ? path.slice(9) : path === "/" ? "/index.html" : path));
    if (!file.startsWith(base + sep) || !await Bun.file(file).exists()) return new Response(null, { status: 404 });
    if (measuring && !fixture && !["/", "/index.html", "/host.js"].includes(path)) assets[measuring].set(path, file);
    const type = /\.(?:m?js)$/.test(path) ? "text/javascript" : path.endsWith(".wasm") ? "application/wasm" : Bun.file(file).type;
    if (paced) {
      let buf = wireCache.get(file);
      if (!buf) { buf = gzipSync(readFileSync(file), { level:9 }); wireCache.set(file,buf); }
      // Model one 40 ms request delay plus 10 Mbit/s per response, including worker requests.
      // Buffering is outside measurement after precompression. Never sleep in the browser.
      const bytes = buf, start = performance.now();
      let pos = 0;
      await Bun.sleep(40);
      const body = new ReadableStream({
        async pull(controller) {
          const end = Math.min(pos+32768,bytes.length);
          await Bun.sleep(Math.max(0, Math.ceil(start+40+end/1250-performance.now())));
          controller.enqueue(bytes.subarray(pos,end));
          pos=end; if (end === bytes.length) controller.close();
        }
      });
      return new Response(body, {headers:{"Content-Encoding":"gzip","Content-Type":type,"Cache-Control":"no-store"}});
    }
    return new Response(Bun.file(file), { headers: { "Content-Type": type } });
  },
});

const data = {
  generatedAt: new Date().toISOString(), viewport, deviceScaleFactor: 1, rounds, burstsPerRound: 6,
  cacheLimit: 2, mainWidth: 900, thumbnailWidth: 160, gapMs: 25,
  platform: process.platform, arch: process.arch, osRelease: release(), cpu: cpus()[0]?.model,
  machineMemoryBytes: totalmem(), bun: Bun.version, chromium: "",
  pdfjs: JSON.parse(readFileSync(`${root}/node_modules/pdfjs-dist/package.json`, "utf8")).version,
  playwright: JSON.parse(readFileSync(`${root}/node_modules/playwright/package.json`, "utf8")).version,
  fixtures: [] as { id: string; bytes: number; sha256: string }[],
  sizes: {} as Record<string, object>,
  opens: [] as { engine: Engine; n: number; round: number; state: string; mainMs: number; firstThumbnailMs: number }[],
  bursts: [] as { engine: Engine; n: number; round: number; burst: number; end: number; clickMs: number;
    precedingClicksMs: number; thumbnailsCompletedAtClick: number; correct: boolean }[],
  memory: [] as { engine: Engine; packets: number; cacheEntries: number; keys: string[]; workers: number;
    mainJsHeapBytes: number; mainBackingStorageBytes: number | null; privateBytes: number | null }[],
};
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function app(b: Browser, engine: Engine) {
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on("pageerror", err => console.error("browser:", err.message));
  p.on("console", msg => { if (msg.type() === "error") console.error("browser:", msg.text()); });
  await p.addInitScript(`window.verifyCanvas = (${verifyCanvas.toString()});`);
  await p.goto(`${server.url}?engine=${engine}`);
  await p.waitForFunction(() => !!(window as any).bench);
  return { p, ctx };
}
const open = (p: Page, id: string) => p.evaluate(id => {
  const t = performance.now(); (window as any).bench.open(id); return t;
}, id);
async function paint(p: Page, from: number, id: string, page = 1, thumb = false) {
  const h = await p.waitForFunction(({from, id, page, thumb}) => {
    const w = window as any, b = w.bench;
    if (b.status().failure) throw Error(b.status().failure);
    const e = b.events.find((e: any) => e.t >= from && e.id === id && e.thumb === thumb && (thumb || e.page === page));
    if (!e) return false;
    const canvas = document.querySelector(thumb ? `button[data-page="${e.page}"] canvas` : "#main-preview canvas");
    if (!w.verifyCanvas(canvas, e.page, id)) throw Error(`Incorrect ${thumb ? "thumbnail" : "main"} pixels: ${id}/${e.page}`);
    return { ms: e.t - from, page: e.page };
  }, {from, id, page, thumb}, { timeout: 120000 });
  try { return (await h.jsonValue()) as {ms:number, page:number}; }
  finally { await h.dispose(); }
}
async function settled(p: Page, n: number) {
  const h = await p.waitForFunction(n => {
    const s = (window as any).bench.status();
    if (s.failure) throw Error(s.failure);
    if (s.pageCount && s.pageCount !== n) throw Error(`Wrong page count: ${s.pageCount}`);
    return !s.busy && s.mainReady && s.painted > 0 && s.visible === s.painted;
  }, n, { timeout: 120000 });
  await h.dispose();
}
async function checkSettled(p: Page, id: string, page: number) {
  await p.evaluate(({ id, page }) => {
    const verify = (window as any).verifyCanvas;
    if (!verify(document.querySelector("#main-preview canvas"), page, id)) throw Error(`Stale main: ${id}/${page}`);
    for (const canvas of document.querySelectorAll("#pages canvas")) {
      const b = canvas.closest("button")!, box = b.getBoundingClientRect(), nav = document.querySelector("#sidebar")!.getBoundingClientRect();
      if (box.top >= nav.bottom || box.bottom <= nav.top) throw Error("Offscreen thumbnail retained");
      if (!verify(canvas, Number(b.dataset.page), id)) throw Error(`Stale thumbnail: ${id}/${b.dataset.page}`);
    }
  }, { id, page });
}
async function timings(b: Browser, engine: Engine, n: number, round: number) {
  const id = `p${n}`, { p, ctx } = await app(b, engine);
  try {
    for (const state of ["cold", "warm"]) {
      const t = await open(p, id);
      const main = await paint(p, t, id);
      const thumbnail = await paint(p, t, id, 1, true);
      if (thumbnail.ms < main.ms) throw Error("Selected page was not rendered first");
      data.opens.push({ engine, n, round, state, mainMs: main.ms, firstThumbnailMs: thumbnail.ms });
      await settled(p, n);
      await p.evaluate(() => (window as any).bench.leave());
    }
  } finally { await ctx.close(); }
  const nav = await app(b, engine);
  try {
    const t = await open(nav.p, id);
    await paint(nav.p, t, id);
    for (let burst = 0; burst < data.burstsPerRound; burst++) {
      const end = 2 + ((round * 31 + burst * 13) % (n - 1));
      const click = await nav.p.evaluate(async ({n, end}) => {
        const b = (window as any).bench, first = performance.now();
        for (const offset of [3, 8, 1]) {
          b.select((end + offset - 1) % n + 1);
          await new Promise(r => setTimeout(r, 25));
        }
        const thumbnailsCompletedAtClick = b.events.filter((e: any) => e.thumb).length;
        const t = performance.now();
        b.select(end);
        return { t, precedingClicksMs: t - first, thumbnailsCompletedAtClick };
      }, { n, end });
      const { ms } = await paint(nav.p, click.t, id, end);
      data.bursts.push({ engine, n, round, burst, end, clickMs: ms, precedingClicksMs: click.precedingClicksMs,
        thumbnailsCompletedAtClick: click.thumbnailsCompletedAtClick, correct: true });
    }
    await settled(nav.p, n);
    await checkSettled(nav.p, id, data.bursts.at(-1)!.end);
  } finally { await nav.ctx.close(); }
}

async function memory(engine: Engine) {
  const b = await chromium.launch();
  try {
    const {p} = await app(b, engine), cdp = await p.context().newCDPSession(p), all = await b.newBrowserCDPSession();
    for (let i = 0; i <= 10; ++i) {
      if (i) {
        const id = `m${i}`, t = await open(p, id);
        await paint(p, t, id);
        await settled(p, 25);
        await checkSettled(p, id, 1);
        await p.evaluate(() => (window as any).bench.leave());
      }
      await cdp.send("HeapProfiler.collectGarbage");
      const heap = await cdp.send("Runtime.getHeapUsage");
      let privateBytes: number | null = null;
      if (process.platform === "win32") {
        const {processInfo} = await all.send("SystemInfo.getProcessInfo");
        const ids = [...new Set(processInfo.map(x => Number(x.id)).filter(x => x > 0))];
        const ps = Bun.spawnSync(["pwsh", "-NoProfile", "-Command",
          `(Get-Process -Id ${ids.join(",")} -ErrorAction Stop | Measure-Object -Property PrivateMemorySize64 -Sum).Sum`]);
        if (ps.exitCode !== 0) throw Error(ps.stderr.toString());
        privateBytes = Number(ps.stdout.toString().trim());
        if (!(privateBytes > 0)) throw Error("Invalid browser private byte count");
      }
      const s = await p.evaluate(() => (window as any).bench.status());
      const expected = Array.from({length: Math.min(i, data.cacheLimit)}, (_, j) =>
        `/fixtures/m${i - Math.min(i, data.cacheLimit) + 1 + j}.pdf`);
      if (s.limit !== data.cacheLimit || JSON.stringify(s.keys) !== JSON.stringify(expected)) throw Error("Cache bound/LRU violation");
      const workers = p.workers().length;
      if (workers > data.cacheLimit) throw Error(`${workers} live workers after ${i} packets`);
      data.memory.push({ engine, packets: i, cacheEntries: s.keys.length, keys: s.keys, workers,
        mainJsHeapBytes: heap.usedSize, mainBackingStorageBytes: heap.backingStorageSize ?? null, privateBytes });
    }
  } finally { await b.close(); }
}
async function smokeTest(b: Browser, engine: Engine) {
  const {p, ctx} = await app(b, engine);
  try {
    // Supersede a pending open and select the rotated page before thumbnails finish.
    await open(p, "p25");
    const t = await open(p, "m1");
    await paint(p, t, "m1");
    const clicked = await p.evaluate(() => { const t = performance.now(); (window as any).bench.select(3); return t; });
    await paint(p, clicked, "m1", 3);
    await settled(p, 25);
    await p.locator("#sidebar").evaluate(el => { el.scrollTop = el.scrollHeight; });
    // Wait for scroll delivery, then for the last row to actually mount.
    await p.waitForSelector('[data-page="25"] canvas', { state: "attached" });
    await settled(p, 25);
    await checkSettled(p, "m1", 3);
    const re = await open(p, "p25");
    await paint(p, re, "p25");
    await settled(p, 25);
    console.log(`PASS ${engine}: packet switch, rotated page, visible thumbnails, warm reopen`);
  } finally { await ctx.close(); }
}

try {
  if (process.argv[2] === "--serve") {
    console.log(`Preview host: ${server.url}`);
    await new Promise(() => {});
  } else if (paced) {
    const b = await chromium.launch();
    try {
      const samples = [];
      // Prime server compression only; each timed case has its own fresh browser context.
      for(const f of ["pkg/folio_wasm.wasm", "wasm-engine.js", "wasm-worker.js", "pdfjs-engine.js"])
        await (await fetch(new URL(f,server.url))).arrayBuffer();
      for(const f of ["pdfjs/build/pdf.min.mjs","pdfjs/build/pdf.worker.min.mjs","fixtures/p250.pdf"])
        await (await fetch(new URL(f,server.url))).arrayBuffer();
      for(let r=0;r<rounds;r++) for(const engine of r%2 ? ["wasm","pdfjs"] as const : engines) {
        const {p,ctx}=await app(b,engine);
        try {
          const t=await open(p,"p250");
          const {ms}=await paint(p,t,"p250");
          samples.push({engine,round:r,ms});
        } finally { await ctx.close(); }
      }
      mkdirSync(`${root}/results`,{recursive:true});
      writeFileSync(`${root}/results/paced.json`,JSON.stringify({pageCount:250,perResponseMbit:10,
        requestDelayMs:40,gzipLevel:9,samples},null,2)+"\n");
    } finally { await b.close(); }
  } else if (smoke) {
    const selected = process.argv[3] ? engines.filter(x => x === process.argv[3]) : engines;
    if (!selected.length) throw Error("Expected pdfjs or wasm");
    const b = await chromium.launch();
    try { for (const e of selected) await smokeTest(b, e); }
    finally { await b.close(); }
  } else {
    for (const id of ["p25", "p250", ...Array.from({length:10}, (_, i) => `m${i+1}`)]) {
      const bytes = readFileSync(`${root}/fixtures/${id}.pdf`);
      data.fixtures.push({ id, bytes: bytes.length, sha256: sha(bytes) });
    }
    mkdirSync(dirname(output), { recursive: true });
    const b = await chromium.launch();
    try {
      data.chromium = b.version();
      for (let r = 0; r < rounds; r++) {
        for (const n of r % 2 ? [250, 25] : [25, 250]) {
          for (const e of r % 2 ? ["wasm","pdfjs"] as const : engines) {
            measuring = e;
            await timings(b, e, n, r);
            console.log(`Round ${r+1}/${rounds}: ${e} ${n} pages`);
          }
        }
      }
    } finally { await b.close(); }
    for (const e of engines) {
      measuring = e;
      await memory(e);
      const files = [...assets[e]].sort().map(([path, filename]) => {
        const buf = readFileSync(filename);
        return { path, rawBytes: buf.length, gzipBytes: gzipSync(buf, {level: 9}).length, sha256: sha(buf) };
      });
      data.sizes[e] = { files, rawBytes: files.reduce((a,f) => a+f.rawBytes, 0),
        gzipBytes: files.reduce((a,f) => a+f.gzipBytes, 0) };
    }
    writeFileSync(output, JSON.stringify(data, null, 2) + "\n");
    console.log(output);
  }
} finally { server.stop(true); }

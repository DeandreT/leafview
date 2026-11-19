import type { Browser } from "playwright";
import { createHash } from "node:crypto";

export const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
export const key = (pages: number, independent: boolean) => `${pages}-${independent ? "independent" : "shared"}`;
export const marker = (pages: number, independent: boolean) => 36 + 40 * Number(pages === 250) + 80 * Number(independent);

// Raw JPEG streams, a flat /Pages tree, page-local objects in reading order,
// ordinary xref at EOF. No linearization, thumbnails, encryption or OCR.
function packet(jpegs: Buffer[], pages: number, independent: boolean) {
  const chunks = [Buffer.from("%PDF-1.4\n%\xD0\xD1\xD2\xD3\n", "latin1")];
  const offsets = [0];
  let length = chunks[0].length;
  function add(...parts: (Buffer | string)[]) {
    for (const p of parts) { const b = Buffer.from(p); chunks.push(b); length += b.length; }
  }
  function obj(...parts: (Buffer | string)[]) {
    const id = offsets.length;
    offsets.push(length); add(`${id} 0 obj\n`, ...parts, "\nendobj\n"); return id;
  }
  obj("<< /Type /Catalog /Pages 2 0 R >>");
  const pageId = (i: number) => 5 + i * (independent ? 3 : 2);
  obj(`<< /Type /Pages /Count ${pages} /Kids [${Array.from({length:pages}, (_,i)=>`${pageId(i)} 0 R`).join(" ")}] >>`);
  let image = 0;
  for (let i = 0; i < pages; i++) {
    if (!i || independent) {
      const jpg = jpegs[i];
      image = obj(`<< /Type /XObject /Subtype /Image /Width 1224 /Height 1584 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, jpg, "\nendstream");
    }
    const rgb = [marker(pages, independent), 16 + 15 * (i >> 4), 16 + 15 * (i & 15)];
    const paint = `q 612 0 0 792 0 0 cm /Scan Do Q\n${rgb.map(x => (x / 255).toFixed(7)).join(" ")} rg 516 670 40 50 re f\n`;
    const contents = obj(`<< /Length ${paint.length} >>\nstream\n${paint}endstream`);
    const id = obj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Scan ${image} 0 R >> >> /Contents ${contents} 0 R >>`);
    if (id !== pageId(i)) throw Error("Page object mismatch");
  }
  const xref = length;
  add(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`, ...offsets.slice(1).map(x => `${String(x).padStart(10,"0")} 00000 n \n`),
    `trailer\n<< /Root 1 0 R /Size ${offsets.length} >>\nstartxref\n${xref}\n%%EOF\n`);
  if (length >= 64 * 1024 ** 2) throw Error(`Too large: ${length}`);
  return Buffer.concat(chunks);
}

export async function fixtures(browser: Browser) {
  const ctx = await browser.newContext();
  const jpegs: Buffer[] = [];
  try {
    const tab = await ctx.newPage();
    for (let page = 1; page <= 250; page++) {
      const encoded = await tab.evaluate(page => {
        const c = document.createElement("canvas"); c.width = 1224; c.height = 1584;
        const g = c.getContext("2d")!, field = g.createImageData(c.width, c.height);
        let seed = (324791 + 67531 * page) >>> 0;
        const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
        for (let i = 0; i < field.data.length; i += 4) {
          const n = 227 + (next() >>> 28);
          field.data[i] = n; field.data[i+1] = n; field.data[i+2] = n; field.data[i+3] = 255;
        }
        g.putImageData(field, 0, 0);
        g.fillStyle = "#171717"; g.fillRect(78, 91, 715, 84);
        g.fillStyle = "white"; g.font = "bold 42px Arial"; g.fillText("RECEIVING INSPECTION", 102, 148);
        g.fillStyle = "#222"; g.font = "29px Arial";
        g.fillText(`Record ${61000 + page}     /     Station ${1 + next() % 37}     /     Copy 1`, 82, 245);
        const goods = ["Packing sleeves", "Label stock", "Rack dividers", "Paper trays", "Dispatch slips"];
        for (let row = 0; row < 17; row++) {
          const y = 350 + row * 64, n = next();
          g.fillText(`${row + 1}.   ${goods[n % goods.length]}`, 90, y);
          g.fillText(`Lot  ${n % 100000}`, 550, y);
          g.fillText(`${1 + n % 288} units`, 898, y);
          g.fillRect(82, y + 15, 1050, 2);
        }
        g.fillText(`Inspector ${page + 500}   /   Synthetic record`, 82, 1510);
        return c.toDataURL("image/jpeg", 0.76).split(",")[1];
      }, page);
      jpegs.push(Buffer.from(encoded, "base64"));
    }
  } finally { await ctx.close(); }
  const unique = new Set(jpegs.map(hash));
  if (unique.size !== 250) throw Error("Expected 250 distinct JPEGs");
  const docs = new Map<string,Buffer>(), metadata = [];
  for (const n of [25,250]) for (const independent of [false,true]) {
    const id = key(n,independent), bytes = packet(jpegs,n,independent);
    docs.set(id, bytes);
    metadata.push({ id, pages: n, imageObjects: independent ? n : 1,
      jpegStreamBytes: jpegs.slice(0,independent ? n : 1).reduce((a,b)=>a+b.length,0),
      firstJpegBytes: jpegs[0].length, firstJpegSha256: hash(jpegs[0]), bytes: bytes.length, sha256: hash(bytes) });
  }
  return { docs, metadata };
}

// Generate in memory. "ΩβΔ" in JIS X 0208 row 6 via the predefined Adobe-Japan1
// /H CMap. Adobe H v10.006 has <2621>..<2638> -> 1011+, <2641>..<2658> -> 1035+.
// An Identity-H control independently addresses the same embedded glyphs by CID.
import {readFileSync} from "node:fs";
import {deflateSync} from "node:zlib";
const buf = x => Buffer.isBuffer(x) ? x : Buffer.from(x);
function stream(x,extra="") {
  const b = deflateSync(buf(x));
  return Buffer.concat([buf(`<< /Filter /FlateDecode /Length ${b.length} ${extra} >>\nstream\n`), b,buf("\nendstream")]);
}
function pdf(objects) {
  const parts = [buf("%PDF-1.5\n")], off=[0]; let pos=parts[0].length;
  objects.forEach((entry,i)=>{
    off.push(pos);
    const body=Buffer.concat([buf(`${i+1} 0 obj\n`),buf(entry),buf("\nendobj\n")]);
    parts.push(body); pos+=body.length;
  });
  parts.push(buf(`xref\n0 ${off.length}\n0000000000 65535 f \n`+off.slice(1).map(n=>`${String(n).padStart(10,"0")} 00000 n \n`).join("")+`trailer\n<< /Size ${off.length} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
  return Buffer.concat(parts);
}
const pages = ["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Count 1 /Kids [3 0 R] >>"];
const page = fonts => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << ${fonts} >> >> /Contents 4 0 R >>`;
function glyphId(font, cp) {
  for(let i=0;i<font.readUInt16BE(4);i++) {
    const p=12+i*16;if(font.toString("ascii",p,p+4)!=="cmap") continue;
    const t=font.readUInt32BE(p+8);
    for(let j=0;j<font.readUInt16BE(t+2);j++){
      const f=t+font.readUInt32BE(t+8+j*8);
      if(font.readUInt16BE(f)!==4)continue;
      const n=font.readUInt16BE(f+6)/2;
      for(let k=0;k<n;k++){
        const e=f+14+k*2,s=e+n*2+2,start=font.readUInt16BE(s);
        if(cp<start || cp>font.readUInt16BE(e))continue;
        const delta=font.readInt16BE(s+n*2), rp=s+n*4, range=font.readUInt16BE(rp);
        const gid = ((range?font.readUInt16BE(rp+range+(cp-start)*2):cp)+delta)&65535;
        if(gid)return gid;
      }
    }
  }throw Error(`Missing glyph U+${cp.toString(16)}`);
}
export function fixtures(root) {
  const font=readFileSync(`${root}/node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf`);
  const map=Buffer.alloc(1037*2);
  for(const [cid,cp] of [[1034,0x3a9],[1036,0x3b2],[1014,0x394]]) map.writeUInt16BE(glyphId(font,cp),cid*2);
  const cid = named => pdf([...pages,page("/F1 5 0 R"),
    stream(`BT /F1 60 Tf 40 250 Td <${named?"263826422624":"040A040C03F6"}> Tj ET`),
    `<< /Type /Font /Subtype /Type0 /BaseFont /LiberationSans /Encoding /${named?"H":"Identity-H"} /DescendantFonts [6 0 R] >>`,
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /LiberationSans /DW 1000 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 1 >> /FontDescriptor 7 0 R /CIDToGIDMap 9 0 R >>",
    "<< /Type /FontDescriptor /FontName /LiberationSans /Flags 4 /FontBBox [-600 -300 1550 1050] /ItalicAngle 0 /Ascent 905 /Descent -212 /CapHeight 688 /StemV 80 /FontFile2 8 0 R >>",
    stream(font,`/Length1 ${font.length}`),stream(map)]);
  const names=["Helvetica","Helvetica-Bold","Helvetica-Oblique","Helvetica-BoldOblique","Courier","Courier-Bold","Courier-Oblique","Courier-BoldOblique","Times-Roman","Times-Bold","Times-Italic","Times-BoldItalic","Symbol","ZapfDingbats"];
  return {"jis":cid(true),"identity":cid(false),"base14":pdf([...pages,page(names.map((_,i)=>`/F${i} ${5+i} 0 R`).join(" ")),stream(names.map((_,i)=>`BT /F${i} 20 Tf 18 ${470-i*32} Td (ABC 123) Tj ET`).join("\n")),
    ...names.map(name=>`<< /Type /Font /Subtype /Type1 /BaseFont /${name} >>`)])};
}

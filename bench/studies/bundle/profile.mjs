import {readFileSync as read, writeFileSync as write} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {encode} from "../../../scripts/precompress.mjs";
export const root=resolve(import.meta.dir,"../../.."), stage=resolve(root,"artifacts/bundle-study");
export const sha = b => createHash("sha256").update(b).digest("hex");
const sectionNames=["custom","type","import","function","table","memory","global","export","start","element","code","data","dataCount","tag"];
function scan(b) {
  let p=8;const sections={}, byId={}, names={}, sizes={};
  const leb=()=>{let x=0,bit=0,n;do {n=b[p++];x+=(n&127)*2**bit;bit+=7;}while(n&128);return x};
  const str=()=>{const n=leb(), t=b.toString("utf8",p,p+n);p+=n;return t};
  let importedFuncs=0;
  while(p<b.length) {
    const start=p,id=b[p++], n=leb(),end=p+n;
    if(id===2){
      for(let i=leb();i;i--){str();str();if(b[p++]!==0)throw Error("Unexpected import kind");leb();importedFuncs++;}
    }
    if(id===10)for(let j=importedFuncs,i=leb();i;i--,j++){const n=leb();sizes[j]=n;p+=n;}
    if(id===0 && str()==="name")while(p<end){const k=b[p++], len=leb(),sub=p+len;if(k===1)for(let i=leb();i;i--){const idx=leb();names[idx]=str();}p=sub;}
    if(id)byId[id]=sha(b.subarray(start,end));
    sections[sectionNames[id]]=(sections[sectionNames[id]]||0)+end-start;
    p=end;
  }
  return {sections,byId,names,sizes};
}
if(import.meta.main){
  const raw={},extra={}, variants={};
  for(const key of ["current","default","fonts","cmaps","neither","lazy","named"]){
    const b=read(key==="current"?`${root}/web/pkg/folio_wasm.wasm`:`${stage}/${key}.wasm`);
    const {sections,byId,names,sizes}=scan(b);
    raw[key]=byId;
    if(key==="named"){
      const matched = Object.keys(byId).every(id=>byId[id]===raw.default[id]);
      const groups={}; const needles=["hayro_jpeg2000","hayro_jbig2","hayro_ccitt","zune_jpeg","brotli_decompressor","hayro_cmap","hayro_font","hayro_interpret","vello_cpu","skrifa","read_fonts","hayro_syntax","miniz_oxide"];
      for(const [id,size] of Object.entries(sizes)){
        const name=names[id]||"", group=needles.find(k=>name.includes(k))||"other";
        const g=groups[group]??={functions:0,bodyBytes:0};g.functions++;g.bodyBytes+=size;
      }
      extra.symbols={matchedDefaultSections:matched,groups,namedCodeBytes:sections.code,
        largest:Object.entries(sizes).sort((a,b)=>b[1]-a[1]).slice(0,15).map(([id,bytes])=>({bytes,name:names[id]}))};
      continue;
    }
    const {br}=encode(b);write(`${stage}/${key}.br`,br);
    variants[key]={sha256:sha(b),rawBytes:b.length,brBytes:br.length,sections};
  }
  const assets=JSON.parse(read(`${stage}/assets.json`)).map(f=>{
    const b=read(`${stage}/lazy-assets/${f.id}.bin`),{br}=encode(b);
    write(`${stage}/lazy-assets/${f.id}.br`,br);
    return {...f,brBytes:br.length,sha256:sha(b)};
  });
  const assetFiles={"engine":"web/wasm-engine.js","worker":"web/wasm-worker.js","lazyWorker":"artifacts/bundle-study/lazy-worker.js"};
  const js=Object.fromEntries(Object.entries(assetFiles).map(([k,v])=>{const b=read(`${root}/${v}`); return [k,{sha256:sha(b),rawBytes:b.length,brBytes:encode(b).br.length}]}));
  write(`${stage}/profile.json`,JSON.stringify({rustc:execFileSync("rustc",["-Vv"],{encoding:"utf8"}).trim(),cargo:execFileSync("cargo",["-V"],{encoding:"utf8"}).trim(),cargoLock:sha(read(`${root}/Cargo.lock`)),variants,assets,js,...extra},null,2));
}

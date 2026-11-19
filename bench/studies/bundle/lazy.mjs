// Experimental split: preserve both default features and the original data and parsers.
import {readFileSync as read, writeFileSync as write, cpSync, mkdirSync, readdirSync, existsSync} from "node:fs";
import {dirname, join} from "node:path";
import {homedir} from "node:os";
import {brotliDecompressSync} from "node:zlib";
const text = p => read(p,"utf8").replaceAll("\r\n","\n");
function replace(file, pattern, replacement) {
  const old = text(file), next = old.replace(pattern,replacement);
  if (next === old) throw Error(`Unmatched patch: ${file}`);
  write(file,next);
}
export function patchCrate(crate) {
  const stage = dirname(crate);
  const cargoSrc = join(process.env.CARGO_HOME || join(homedir(),".cargo"),"registry/src");
  const dep = name => join(cargoSrc,readdirSync(cargoSrc).find(d=>existsSync(join(cargoSrc,d,name))),name);
  const cmap = "hayro-cmap-0.1.1", font = "hayro-font-0.5.0";
  const assets = join(stage,"lazy-assets");
  mkdirSync(assets,{recursive:true});
  for (const name of [cmap,font]) {
    cpSync(dep(name),join(crate,name),{recursive:true});
    const toml = join(crate,name,"Cargo.toml");
    write(toml,text(toml)+'\n[dependencies.study-assets]\npath = "../study-assets"\n');
  }
  const m = join(crate,"Cargo.toml");
  write(m,text(m)+`\n[patch.crates-io]\nhayro-font={path="${font}"}\nhayro-cmap={path="${cmap}"}\n`);
  const helper = join(crate,"study-assets");
  mkdirSync(join(helper,"src"),{recursive:true});
  write(join(helper,"Cargo.toml"),'[package]\nname="study-assets"\nversion="0.1.0"\nedition="2024"\n');
  write(join(helper,"src/lib.rs"),`#[link(wasm_import_module = "study")]
unsafe extern "C" { fn copy_asset(id: u32, dst: *mut u8, len: usize); }
pub fn load(id: u32, len: usize) -> Vec<u8> {
    let mut out = vec![0; len];
    // The trusted worker verifies the fixed asset's decoded length, writes exactly
    // len bytes to this live allocation and never calls back into the instance.
    unsafe { copy_asset(id, out.as_mut_ptr(), len); }
    out
}\n`);
  const data = brotliDecompressSync(read(join(crate,cmap,"assets/cmaps.brotli")));
  write(join(assets,"0.bin"),data);
  const files = [{name:"cmaps",bytes:data.length,id:0}];
  replace(join(crate,cmap,"src/bcmap/embedded.rs"),/let compressed = include_bytes!\([\s\S]*?\.unwrap\(\);/,
    `let decompressed = study_assets::load(0, ${data.length});`);
  // Common invoice typefaces stay inline. Preserve all other Base-14 substitutes.
  replace(join(crate,font,"src/standard_font.rs"),/let data = match self \{([\s\S]*?)\n        \};\n\n        \(Arc::new\(data\), 0\)/,
    (_all,arms) => {
      const body = [...arms.matchAll(/Self::(\w+) =>[\s\S]*?include_bytes!\("\.\.\/assets\/([^"]+)"\)/g)].map(([,key,name])=>{
        if (["Helvetica","HelveticaBold","Courier"].includes(key))
          return `Self::${key} => Arc::new(&include_bytes!("../assets/${name}")[..]),`;
        const bin = read(join(crate,font,"assets",name)), id = files.length;
        files.push({id,name,bytes:bin.length}); write(join(assets,`${id}.bin`),bin);
        return `Self::${key} => Arc::new(study_assets::load(${id}, ${bin.length})),`;
      });
      if(body.length !== 14) throw Error("unrecognized Base-14 arms");
      return 'let data: crate::FontData = match self {\n'+body.join("\n")+'\n};\n(data,0)';
    });
  write(join(stage,"assets.json"),JSON.stringify(files));
  const worker = text(join(stage,"../../web/wasm-worker.js"));
  write(join(stage,"lazy-worker.js"),worker.replace("WebAssembly.instantiate(module, {})","WebAssembly.instantiate(module, {study:{copy_asset}})") + `
const store = new Map();
function copy_asset(id, ptr, size) {
  let data = store.get(id);
  if (!data) {
    // Dedicated worker only: Hayro resolves fonts synchronously, including inside
    // nested form resources. A missing asset fails the render before any paint.
    const xhr = new XMLHttpRequest();
    xhr.open('GET', new URL('./resources/' + id + '.bin', import.meta.url), false);
    xhr.responseType = 'arraybuffer'; xhr.send();
    if (xhr.status !== 200 || xhr.response?.byteLength !== size) throw Error('Invalid renderer asset ' + id);
    data = new Uint8Array(xhr.response);
    if (id !== 0) store.set(id, data); // CMaps live in Rust's LazyLock after first use.
  }
  new Uint8Array(wasm.memory.buffer, ptr, size).set(data);
}\n`);
}

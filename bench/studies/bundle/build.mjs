// Run via locked.ps1. Cargo inputs are copied; no production target or package writes.
import { cpSync, mkdirSync, readFileSync as read, writeFileSync as write } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
const root = resolve(import.meta.dir, "../../.."), stage = resolve(root, "artifacts/bundle-study");
const crate = resolve(stage, "crate"), target = resolve(stage,"target");
mkdirSync(crate, { recursive:true });
cpSync(`${root}/src`, `${crate}/src`, {recursive:true});
const manifest = read(`${root}/Cargo.toml`,"utf8");
const cmd = (args, extra={}) => execFileSync("cargo",args,{cwd:crate, stdio:"inherit",
  env:{...process.env,CARGO_TARGET_DIR:target,...extra}});
for (const variant of process.argv.slice(2).length ? process.argv.slice(2) : ["default","fonts","cmaps","neither","named"]) {
  if (!["default","fonts","cmaps","neither","named","lazy"].includes(variant)) throw Error(variant);
  const features = variant === "fonts" || variant === "lazy" ? ["embed-fonts"] : variant === "cmaps" ? ["embed-cmaps"] : [];
  cpSync(`${root}/Cargo.lock`, `${crate}/Cargo.lock`);
  const base = variant === "default" || variant === "named";
  write(`${crate}/Cargo.toml`, base || variant === "lazy" ? manifest : manifest.replace('hayro = "=0.9.0"',`hayro = {version="=0.9.0", default-features=false, features=${JSON.stringify(features)}}`));
  cpSync(`${root}/src/lib.rs`,`${crate}/src/lib.rs`);
  if (variant === "lazy") (await import("./lazy.mjs")).patchCrate(crate);
  // Disabling optional deps may prune the lockfile. Keep the exact pinned versions.
  if (!base) {
    cmd(["metadata","--offline","--format-version=1","--no-deps"]);
    cmd(["tree","--offline","-e","normal","--depth","1"]);
    const ids = l => [...l.matchAll(/\[\[package\]\]\s+name = "([^"]+)"\s+version = "([^"]+)"/g)].map(m=>`${m[1]}@${m[2]}`);
    const pinned = new Set(ids(read(`${root}/Cargo.lock`,"utf8")));
    if (variant === "lazy") pinned.add("study-assets@0.1.0");
    if(ids(read(`${crate}/Cargo.lock`,"utf8")).some(id=>!pinned.has(id))) throw Error("Dependency version drift");
  }
  cmd(["rustc","--offline","--locked","--release","--target","wasm32-unknown-unknown","--lib","--","-C","link-arg=--max-memory=805306368"],
    variant === "named" ? {CARGO_PROFILE_RELEASE_STRIP:"none"} : {});
  cpSync(`${target}/wasm32-unknown-unknown/release/folio_wasm.wasm`,`${stage}/${variant}.wasm`);
}

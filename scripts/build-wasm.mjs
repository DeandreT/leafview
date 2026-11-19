// bun scripts/build-wasm.mjs (after cargo fetch --locked and rustup target add)
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { deepStrictEqual } from "node:assert";
import { splitHayro } from "./split-hayro.mjs";
import { writeNotices } from "./renderer-notices.mjs";

const root = resolve(import.meta.dir, ".."), target = "wasm32-unknown-unknown";
const metadata = (cwd, args) => JSON.parse(execFileSync("cargo",
  ["metadata", "--offline", "--format-version=1", "--filter-platform", target, ...args],
  { cwd, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" }));
const baseline = metadata(root, ["--locked"]);
const stage = join(root, "artifacts/renderer-build"), output = join(stage, "web");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(root, "src"), join(stage, "src"), { recursive: true });
cpSync(join(root, "Cargo.lock"), join(stage, "Cargo.lock"));
const manifest = readFileSync(join(root, "Cargo.toml"), "utf8");
writeFileSync(join(stage, "Cargo.toml"), manifest + `
[patch.crates-io]
hayro-font = { path = "hayro-font" }
hayro-cmap = { path = "hayro-cmap" }
`);
splitHayro(baseline.packages, stage, output);
metadata(stage, []); // Let Cargo derive the path-patched lock offline, then verify it.
const lock = dir => Bun.TOML.parse(readFileSync(join(dir, "Cargo.lock"), "utf8")).package;
const expected = lock(root);
for (const p of expected.filter(p => ["hayro-font", "hayro-cmap"].includes(p.name))) {
  delete p.source;
  delete p.checksum;
  p.dependencies.push("leafview-assets");
  p.dependencies.sort();
}
expected.push({ name: "leafview-assets", version: "0.1.0" });
const byName = (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version);
deepStrictEqual(lock(stage).sort(byName), expected.sort(byName), "Unexpected Cargo dependency drift");
execFileSync("cargo", ["rustc", "--offline", "--locked", "--release", "--target", target,
  "--target-dir", baseline.target_directory, "--lib", "--", "-C", "link-arg=--max-memory=805306368"],
  { cwd: stage, stdio: "inherit" });
const filename = "folio_wasm.wasm", pkg = join(output, "pkg");
const binary = readFileSync(join(baseline.target_directory, target, "release", filename));
deepStrictEqual(WebAssembly.Module.imports(new WebAssembly.Module(binary)),
  [{ module: "leafview", name: "copy_asset", kind: "function" }], "Unexpected WASM imports");
writeFileSync(join(pkg, filename), binary);
writeNotices(baseline.packages.filter(p => p.source !== null), pkg);
cpSync(pkg, join(root, "web/pkg"), { recursive: true });
console.log(`Built web/pkg/${filename}: ${binary.length} bytes + 12 on-demand resources`);

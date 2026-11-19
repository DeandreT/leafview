// Run with `bun scripts/build-wasm.mjs`.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = "wasm32-unknown-unknown";
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit" });
run("rustup", ["target", "add", target]);
run("cargo", ["rustc", "--locked", "--release", "--target", target, "--lib", "--",
  "-C", "link-arg=--max-memory=805306368"]);
const { target_directory } = JSON.parse(execFileSync("cargo",
  ["metadata", "--locked", "--no-deps", "--format-version=1"], { cwd: root, encoding: "utf8" }));
const pkg = join(root, "web", "pkg");
mkdirSync(pkg, { recursive: true });
const filename = "folio_wasm.wasm";
copyFileSync(join(target_directory, target, "release", filename), join(pkg, filename));
console.log(`web/pkg/${filename}: ${statSync(join(pkg, filename)).size} bytes`);

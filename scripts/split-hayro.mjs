import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { brotliDecompressSync, crc32 } from "node:zlib";
import { resources, verifyResource } from "./renderer-resources.mjs";

// These two private Hayro entry points have no public API accepting the packed
// CMap bundle. Keep Hayro's parser, resolver and default features unchanged;
// replace just the original byte sources in build-local registry copies.
export function splitHayro(packages, stage, web) {
  const deps = {};
  for (const [name, version] of [["hayro-font", "0.5.0"], ["hayro-cmap", "0.1.1"]]) {
    const dep = packages.find(p => p.name === name && p.version === version);
    if (!dep) throw Error(`Expected locked ${name} ${version}`);
    const dest = join(stage, name);
    deps[name] = dest;
    cpSync(dirname(dep.manifest_path), dest, { recursive: true });
    const manifest = join(dest, "Cargo.toml");
    writeFileSync(manifest, readFileSync(manifest, "utf8") +
      '\n[dependencies.leafview-assets]\npath = "../asset-bridge"\n');
  }
  cpSync(join(import.meta.dir, "asset-bridge"), join(stage, "asset-bridge"), { recursive: true });
  const loads = new Map();
  mkdirSync(join(web, "pkg/resources"), { recursive: true });
  for (const r of resources) {
    const bytes = r.id === 0
      ? brotliDecompressSync(readFileSync(join(deps["hayro-cmap"], "assets/cmaps.brotli")))
      : readFileSync(join(deps["hayro-font"], "assets", r.name));
    verifyResource(r, bytes);
    writeFileSync(join(web, r.path), bytes);
    loads.set(r.name, `leafview_assets::load(${r.id}, ${bytes.length}, ${crc32(bytes)})`);
  }

  function patch(crate, file, pattern, fn) {
    const path = join(deps[crate], file);
    const src = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
    if (!pattern.test(src)) throw Error(`Unexpected ${crate}/${file}; review the resource split`);
    writeFileSync(path, src.replace(pattern, fn));
  }
  patch("hayro-cmap", "src/bcmap/embedded.rs",
    /let compressed = include_bytes!\("\.\.\/\.\.\/assets\/cmaps\.brotli"\);[\s\S]*?brotli::BrotliDecompress[\s\S]*?\.unwrap\(\);/,
    `let decompressed = ${loads.get("cmaps")};`);
  patch("hayro-font", "src/standard_font.rs",
    /let data = match self \{([\s\S]*?)\n        \};\n\n        \(Arc::new\(data\), 0\)/,
    (_, body) => {
      const arms = [...body.matchAll(/Self::(\w+) =>[\s\S]*?include_bytes!\("\.\.\/assets\/([^"]+)"\)/g)];
      const inline = ["FoxitSans.pfb", "FoxitSansBold.pfb", "FoxitFixed.pfb"];
      if (arms.length !== 14 || new Set(arms.map(m => m[2])).size !== 14)
        throw Error("Unexpected Base-14 font mapping");
      return "let data: crate::FontData = match self {\n" + arms.map(([, key, name]) => {
        const bytes = inline.includes(name) ? `&include_bytes!("../assets/${name}")[..]` : loads.get(name);
        if (!bytes) throw Error(`Unknown Base-14 asset: ${name}`);
        return `Self::${key} => Arc::new(${bytes}),`;
      }).join("\n") + "\n};\n(data, 0)";
    });
}

import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Preserve nested data licenses as well as the crates' own notices. Deduplicate
// identical license bodies, retaining the full package/version/path attribution.
export function writeNotices(packages, pkgDir) {
  const assetNotices = {
    "hayro-cmap": ["assets/LICENSE.txt"],
    "hayro-font": ["assets/LICENSE_FOXIT", "assets/README.md"],
    "hayro-jpeg2000": ["assets/LICENSE.txt", "assets/README.md"],
  };
  const texts = new Map();
  const add = (path, label) => {
    const text = readFileSync(path, "utf8").replaceAll("\r\n", "\n").trimEnd();
    if (!text) throw Error(`Empty license: ${path}`);
    if (!texts.has(text)) texts.set(text, []);
    texts.get(text).push(label);
  };
  const listing = [];
  for (const p of packages) {
    const base = dirname(p.manifest_path);
    const files = readdirSync(base, { recursive: true, encoding: "utf8" })
      .map(f => f.replaceAll("\\", "/")).filter(f =>
        /(?:^|\/)(?:licen[sc]e|notice|copying|copyright|authors|ofl)(?:$|[._ -])/i.test(f) ||
        f === "assets/README.md" || (p.license_file && f === p.license_file)).sort();
    const label = `${p.name} ${p.version}`;
    for (const file of assetNotices[p.name] ?? [])
      if (!files.includes(file)) throw Error(`Missing bundled data notice: ${label}/${file}`);
    listing.push(`${label} — ${p.license ?? p.license_file} — ${p.repository ?? ""}`);
    for (const f of files) add(join(base, f), `${label}: ${f}`);
    if (files.length) continue;
    // alloc-stdlib is the stdlib/ subcrate of the same Dropbox repository;
    // its .crate archive omits the common BSD-3-Clause file.
    if (p.name !== "alloc-stdlib") throw Error(`Missing notice for ${label}`);
    const sibling = packages.find(q => q.name === "alloc-no-stdlib" && q.repository === p.repository);
    add(join(dirname(sibling.manifest_path), "LICENSE"), `${label}: common repository LICENSE`);
  }
  writeFileSync(join(pkgDir, "THIRD_PARTY_NOTICES.txt"),
    `Leafview renderer dependencies, including build dependencies\n\n${listing.join("\n")}\n\n` +
    [...texts].map(([text, labels]) => `${labels.join("\n")}\n\n${text}\n`).join("\n--------\n\n"));
  const sysroot = execFileSync("rustc", ["--print", "sysroot"], { encoding: "utf8" }).trim();
  copyFileSync(join(sysroot, "share/doc/rust/COPYRIGHT-library.html"), join(pkgDir, "RUST-STDLIB-NOTICES.html"));
}

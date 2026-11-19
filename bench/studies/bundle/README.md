# Reproduce the first-download study

Use the repository's pinned `Cargo.lock`, Bun dependency install, generated `fixtures/{p250,p25}.pdf`, assembled `web/pkg/folio_wasm.wasm`, and Playwright Chromium. For matching output use the Rust and browser versions recorded in `results/bundle-study.json`. Make `bun`, `cargo` and `rustc` available on `PATH` and install `wasm32-unknown-unknown`. Frozen Cargo dependencies must already be available offline (`cargo fetch --locked` if needed).

From the repository root in PowerShell:

```powershell
pwsh -File bench/studies/bundle/locked.ps1 build.mjs default fonts cmaps neither lazy named
pwsh -File bench/studies/bundle/locked.ps1 profile.mjs
pwsh -File bench/studies/bundle/locked.ps1 browser.ts
bun bench/studies/bundle/report.mjs
```

Each command takes the same Windows named mutex across all studies. All compile inputs and targets are in `artifacts/bundle-study/`; Cargo finds the repo's `.cargo/config.toml` through the staged crate's parent directory. Build flags mirror `scripts/build-wasm.mjs`. The 2×2 feature matrix uses unmodified crates; only staged copies of two registry crates are patched for `lazy`. The optional-dependency lockfile for each variant is derived offline from the checked-in lock and versions are checked. `named` mirrors the full build with symbols retained for approximate code attribution. The actual delivered binary is profiled and timed as `current`.

The static profiles use the same Brotli 11 round-trip-checked encoder as delivery. Quality is tested via the real Wasm engine and worker: 900-pixel-wide canvas RGBA digests, a text-only invoice title region, and dark-pixel counts. The JIS and Identity-H controls and the complete Base-14 sheet are generated in memory. The JIS fixture uses the installed PDF.js package's Liberation Sans font (no local OS font or external CMap required); source character codes come from Adobe's `H` mapping. The paced test uses the unchanged preview application. Each HTTP response receives its own 40 ms delay and 10 Mbit/s paced stream. Compression and fixture construction happen before timing. Cold runs alternate order; each opens `p250` and then distinct `p25` in a fresh browser context. Measurements end at the first main preview event recorded by the host.

The scripts retain the complete run in `results/bundle-study.json`. To remove this study's staged crate copies, binaries and target after review:

```powershell
Remove-Item -LiteralPath artifacts/bundle-study -Recurse -Force
```

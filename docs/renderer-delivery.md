# Build and verify the renderer

Install Bun, Rust (1.99.1 used for the recorded pixel checks), and fetch the locked inputs once:

```sh
rustup target add wasm32-unknown-unknown
rustup component add rust-docs
cargo fetch --locked
bun install --frozen-lockfile
bunx --bun playwright install chromium
```

Then, from the repository root, build and package without network access:

```sh
bun scripts/build-wasm.mjs
bun scripts/precompress.mjs
bun scripts/precompress.mjs --verify
bun bench/renderer-assets.test.mjs
```

The default build copies two registry crates to `artifacts/renderer-build/` and changes only their byte sources. Cargo metadata locates the pinned crate sources (including with a custom `CARGO_HOME`). The staged lock is checked against `Cargo.lock` and compiled with `--offline --locked`; the registry and source tree are never patched. The root Cargo manifest without this build step produces the original embedded renderer. `web/pkg/` is the local browser build.

Serve **all of `artifacts/delivery/`** under one same-origin versioned prefix. `pkg/resources/0.bin` contains the decoded binary bundle consumed by Hayro's CMap reader. `1.bin`–`11.bin` are byte-identical Foxit fonts. The common Helvetica, Helvetica Bold and Courier fonts stay inline. Request URLs always end in `.bin`: a server may select its `.br` or `.gz` sibling only with the matching HTTP `Content-Encoding`. Use `application/octet-stream` for these bodies and `Vary: Accept-Encoding`; do not serve upstream `cmaps.brotli` as the identity file. Keep the notice files with the module and distribute its corresponding source.

`precompress.mjs [output-dir]` checks the pinned decoded SHA-256 for every resource and re-reads all written encodings; `--verify [output-dir]` checks an existing directory against this checkout/build. The browser test runs with a nested deployment prefix and checks invoice/Identity-H, all Base-14 fonts, and named JIS CMap text against the embedded renderer's canvas hashes. It also checks missing and same-length corrupt sidecars, no partial paints, and recovery by opening a fresh document. Generate `fixtures/p250.pdf` with `python bench/generate.py` (see the main README) before the test.

Each worker requests data only on first use. If a required file cannot be loaded or fails the size/CRC check, that document fails before paint. Restore the matching asset and reopen the document to retry with a new private instance. The checksum detects deployment mistakes; it is not a signature. Only serve trusted renderer assets.

The same browser check compares a worker-transferred `ImageBitmap` at width 1600 with the RGBA reference. It also covers unflagged requests, width 1599, and an unavailable worker canvas 2D context.

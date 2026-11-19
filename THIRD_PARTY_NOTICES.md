# Licensing

Original source: copyright Deandre Thomas, licensed under GPL-3.0-only; see `COPYING`. The generated corpus uses synthetic content. The generator and canvas marker checks are adapted from the paprika client preview benchmark under the same license.

This source repository does not vendor the following packages. Preserve their upstream notices when packaging a browser build:

- [Hayro](https://github.com/LaurenzV/hayro) 0.9.0 and its Rust dependencies supply PDF parsing, interpretation and rasterization. Hayro is MIT OR Apache-2.0. Its embedded font substitutes and predefined character maps have their own notices; they are part of the generated WASM payload.
- [PDF.js](https://github.com/mozilla/pdf.js) 5.4.624 (Apache-2.0) supplies the comparator. Font resources, character maps and optional decoders carry additional licenses in `pdfjs-dist/standard_fonts`, `cmaps`, and `wasm`.
- The browser tests use [Playwright](https://github.com/microsoft/playwright) (Apache-2.0); the synthetic fixture generator uses ReportLab and Pillow. These are development dependencies.

`Cargo.lock` and `bun.lock` pin dependencies for this experiment. Building locally is separate from assembling a distributable binary with corresponding source and complete third-party notices.

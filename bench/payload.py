"""Estimate deployable engine sizes (gzip -9 per asset); not a network simulation."""
import gzip
import json
from pathlib import Path


def sizes(files):
    result = {}
    for p in sorted(files):
        b = p.read_bytes()
        result[p.as_posix()] = {"bytes": len(b), "gzipBytes": len(gzip.compress(b, compresslevel=9, mtime=0))}
    return {"assets": result, "bytes": sum(x["bytes"] for x in result.values()),
            "gzipBytes": sum(x["gzipBytes"] for x in result.values())}


root = Path("node_modules/pdfjs-dist/build")
pkg = Path("web/pkg")
if not list(pkg.glob("*.wasm")):
    raise SystemExit("Build the WASM module first")
worker = Path("web/pdfjs-engine.js").read_text()
variant = ".min" if "pdf.min.mjs" in worker else ""
pdf = [root / f"pdf{variant}.mjs", root / f"pdf.worker{variant}.mjs", Path("web/pdfjs-engine.js")]
wasm = [*pkg.glob("*.wasm"), *pkg.glob("*.js"), Path("web/wasm-engine.js"), Path("web/wasm-worker.js")]
result = {"note": "Core assets only. Optional PDF.js fonts, CMaps and image decoders are additional on demand.",
          "pdfjs": sizes(pdf), "wasm": sizes(wasm)}
Path("results").mkdir(exist_ok=True)
Path("results/payload.json").write_text(json.dumps(result, indent=2) + "\n")
for k in ["pdfjs", "wasm"]:
    print(k, result[k]["bytes"], "bytes,", result[k]["gzipBytes"], "gzip bytes")

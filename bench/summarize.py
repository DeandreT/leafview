"""Print medians, nearest-rank p95, memory, and cold engine asset footprint."""
import json
import math
import statistics
import sys


def summary(data):
    print("Milliseconds: median open and first thumbnail; median / nearest-rank p95 selection")
    print("| Pages | Engine | Cold preview | Cold thumb | Warm preview | Warm thumb | Last click median | p95 | Verified |")
    print("|---:|:---|---:|---:|---:|---:|---:|---:|---:|")
    for n in (25, 250):
        for engine in ("pdfjs", "wasm"):
            opens = [x for x in data["opens"] if x["engine"] == engine and x["n"] == n]
            bursts = [x for x in data["bursts"] if x["engine"] == engine and x["n"] == n]
            times = sorted(x["clickMs"] for x in bursts)
            ms = [statistics.median(x[field] for x in opens if x["state"] == state)
                  for state in ("cold", "warm") for field in ("mainMs", "firstThumbnailMs")]
            ms += [statistics.median(times), times[math.ceil(.95 * len(times)) - 1]]
            print("|", " | ".join([str(n), engine, *(f"{x:.1f}" for x in ms),
                                   f"{sum(x['correct'] for x in bursts)}/{len(bursts)}"]), "|")
    print("\nAfter leaving packets, main-target GC (MiB):")
    for x in data["memory"]:
        if x["packets"] not in (0, 1, 5, 10):
            continue
        private = "n/a" if x["privateBytes"] is None else f"{x['privateBytes']/2**20:.1f}"
        print(f"{x['engine']:5} {x['packets']:2} packets | docs {x['cacheEntries']} | "
              f"workers {x['workers']} | main JS {x['mainJsHeapBytes']/2**20:.1f} | browser private {private}")
    print("\nUnique engine assets requested (shared shell and fixtures excluded; gzip level 9 per file):")
    for e, s in data["sizes"].items():
        print(f"{e}: {s['rawBytes']:,} bytes raw, {s['gzipBytes']:,} bytes gzip ({len(s['files'])} files)")


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8") as f:
        summary(json.load(f))

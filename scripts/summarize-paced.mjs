// bun scripts/summarize-paced.mjs [paced-codecs.json]
import { readFileSync } from "node:fs";
const data = JSON.parse(readFileSync(process.argv[2] || new URL("../artifacts/paced-codecs.json",import.meta.url), "utf8"));
const median = values => {
  const a = values.toSorted((x,y) => x-y), m = Math.floor(a.length/2);
  return a.length%2 ? a[m] : (a[m-1]+a[m])/2;
};
const rows = [];
for (const codec of ["gzip","br"]) for (const engine of ["pdfjs","wasm"]) {
  const cases = data.samples.filter(s => s.codec === codec && s.engine === engine);
  if (cases.length !== data.rounds || cases.some(s => s.documents.length !== 2 ||
    s.documents.some(d => !d.verifiedMarkers))) throw Error(`Incomplete ${codec}/${engine} evidence`);
  const cold = cases.map(s => s.documents[0]), second = cases.map(s => s.documents[1]);
  const main = median(cold.map(d => d.mainMs));
  const largest = median(cold.map(d => Math.max(...d.transfers.map(t => t.encodedBodyBytes))));
  const floor = data.requestDelayMs + largest * 8 / (data.perResponseMbit * 1000);
  rows.push({ codec, engine, wasmBytes: median(cold.map(d => d.wasmEncodedBodyBytes)),
    secondWasmBytes: median(second.map(d => d.wasmEncodedBodyBytes)), largestResponseBytes: largest,
    floorMs: floor.toFixed(1), firstMs: main.toFixed(1), aboveFloorMs: (main-floor).toFixed(1),
    secondMs: median(second.map(d => d.mainMs)).toFixed(1) });
}
console.table(rows);

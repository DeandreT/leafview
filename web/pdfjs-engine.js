import { getDocument, GlobalWorkerOptions } from "/pdfjs/build/pdf.min.mjs";

GlobalWorkerOptions.workerSrc = "/pdfjs/build/pdf.worker.min.mjs";
export async function openDocument(url) {
  const task = getDocument({ url, standardFontDataUrl: "/pdfjs/standard_fonts/",
    cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, wasmUrl: "/pdfjs/wasm/" });
  let pdf;
  try { pdf = await task.promise; }
  catch (err) { await task.destroy(); throw err; }
  return {
    pageCount: pdf.numPages,
    async render(n, width, canvas) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
      canvas.width = width;
      canvas.height = Math.max(1, Math.round(viewport.height));
      await page.render({ canvas, viewport }).promise;
    },
    destroy: () => task.destroy(),
  };
}

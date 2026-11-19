/**
 * Verify the rendered page, even when two files have the same page count.
 * `page` is 1-based. `packetId` is the filename stem: p25, p250, or m1..m10.
 * Use a full-page 2D canvas with intrinsic PDF rotation applied (no clipping
 * or letterboxing). Read its backing pixels, independent of CSS scale/site DPR.
 *
 * All pages have one opaque DeviceRGB rectangle, 1/16 of display width and
 * height, centered at (7/8, 1/8) measured from the displayed top-left.
 * R encodes the packet; G and B encode the two nibbles of (page - 1).
 * Example: page 17 of m1 has RGB (56, 31, 16). Allow ±4 levels per channel;
 * the minimum channel step is 15, so neighboring markers cannot both pass.
 *
 * The compiled function is self-contained: serialize verifyCanvas.toString()
 * and invoke it in the browser realm with the canvas, page and packet ID.
 */
export function verifyCanvas(canvas: HTMLCanvasElement, page: number, packetId: string): boolean {
  const code = ['p25', 'p250', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10'].indexOf(packetId);
  if (code < 0 || !Number.isInteger(page) || page < 1 || page > (code === 1 ? 250 : 25)) return false;
  if (!canvas || canvas.width < 32 || canvas.height < 32) return false;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const pixel = ctx.getImageData(Math.floor(canvas.width * 7 / 8), Math.floor(canvas.height / 8), 1, 1).data;
  const n = page - 1;
  return pixel[3] === 255
    && Math.abs(pixel[0] - (16 + 20 * code)) <= 4
    && Math.abs(pixel[1] - (16 + 15 * (n >> 4))) <= 4
    && Math.abs(pixel[2] - (16 + 15 * (n & 15))) <= 4;
}

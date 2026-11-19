// Runs inside the measured page. No readback from the presentation context.
const frame = () => new Promise(r => requestAnimationFrame(r));
let doc, canvas, scratch, submit;
function getMarker(ctx, x, y, page) {
  const px = Array.from(ctx.getImageData(x, y, 1, 1).data);
  const expected = [16, 16 + 15 * ((page-1) >> 4), 16 + 15 * ((page-1) & 15)];
  if (px[3] !== 255 || expected.some((v,i) => Math.abs(px[i]-v) > 4)) throw Error(`Wrong marker ${page}: ${px}`);
  return px;
}
async function init(mode) {
  canvas = document.body.appendChild(document.createElement("canvas"));
  canvas.style.cssText = "width:600px;height:auto;display:block";
  scratch = new OffscreenCanvas(1,1).getContext("2d", {willReadFrequently:true});
  const ctx = canvas.getContext(mode === "baseline" ? "2d" : "bitmaprenderer");
  const method = mode === "baseline" ? "putImageData" : "transferFromImageBitmap";
  const original = ctx[method].bind(ctx);
  ctx[method] = (...args) => {
    const t = performance.now(); original(...args); submit = performance.now() - t;
  };
  doc = await (await import(`/${mode}/wasm-engine.js`)).openDocument("/fixtures/p25.pdf");
  if (doc.pageCount !== 25) throw Error("Wrong fixture");
  let resolution = Infinity, prev = performance.now();
  for (let i=0;i<10000;i++) {
    const t = performance.now();
    if (t>prev) resolution = Math.min(resolution,t-prev);
    prev = t;
  }
  return {clockStepMs:resolution, isolated:crossOriginIsolated};
}
async function draw(page,width) {
  submit = null;
  const start = performance.now();
  await doc.render(page,width,canvas);
  const done = performance.now();
  if (submit === null) throw Error("Missing presentation");
  await frame(); await frame();
  const after = performance.now();
  scratch.drawImage(canvas, Math.floor(canvas.width*7/8), Math.floor(canvas.height/8), 1,1,0,0,1,1);
  const marker = getMarker(scratch,0,0,page);
  return {page, width, height:canvas.height, renderMs:done-start, mainSubmitMs:submit,
    afterFrameMs:after-start, verifiedMs:performance.now()-start, marker};
}
async function fingerprint(page,width) {
  await draw(page,width);
  const c = new OffscreenCanvas(width,canvas.height).getContext("2d",{willReadFrequently:true});
  c.drawImage(canvas,0,0);
  const rgba = c.getImageData(0,0,width,canvas.height).data;
  const hash = await crypto.subtle.digest("SHA-256",rgba);
  return {page,width,height:canvas.height,sha256:Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,"0")).join("")};
}
function markerClip() {
  const box = canvas.getBoundingClientRect();
  return {x:Math.floor(box.left+box.width*7/8),y:Math.floor(box.top+box.height/8),width:1,height:1};
}
async function screenshotMarker({page,base64}) {
  const image = await createImageBitmap(new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:"image/png"}));
  try {
    if (image.width !== 1 || image.height !== 1) throw Error("Wrong screenshot clip");
    scratch.drawImage(image,0,0);
    return getMarker(scratch,0,0,page);
  } finally { image.close(); }
}
Object.assign(window,{init,draw,fingerprint,markerClip,screenshotMarker,done:()=>doc.destroy()});

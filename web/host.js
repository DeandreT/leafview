const engine = new URLSearchParams(location.search).get("engine") || "pdfjs";
if (!["pdfjs", "wasm"].includes(engine)) throw Error("Unknown engine");
const $ = s => document.querySelector(s);
$("#mode").textContent = engine;
const main = $("#main-preview"), sidebar = $("#sidebar"), pages = $("#pages");
const limit = 2, cache = new Map(), events = [];
let active, busy = false, failure = "";
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));

// All document creation, drawing and destruction runs on one serial queue.
// A request may change during any await; only publish a canvas if it still
// belongs to the current view and selection. Eviction cannot race a render.
async function documentFor(url) {
  if (cache.has(url)) {
    const doc = cache.get(url);
    cache.delete(url);
    cache.set(url, doc);
    return doc;
  }
  if (cache.size === limit) {
    const oldest = cache.keys().next().value;
    await cache.get(oldest).destroy();
    cache.delete(oldest);
  }
  const api = engine === "pdfjs" ? await import("./pdfjs-engine.js") : await import("./wasm-engine.js");
  const doc = await api.openDocument(url);
  cache.set(url, doc);
  return doc;
}

function visible(s) {
  const bounds = sidebar.getBoundingClientRect();
  const next = new Set();
  for (let i = 0; i < s.buttons.length; i++) {
    const b = s.buttons[i], box = b.getBoundingClientRect();
    if (box.top < bounds.bottom && box.bottom > bounds.top) next.add(i + 1);
    else if (s.painted.delete(i + 1)) b.firstChild.replaceChildren();
  }
  s.visible = next;
}
function choose(s, page) {
  if (s !== active || s.page === page) return;
  s.buttons[s.page - 1].setAttribute("aria-pressed", "false");
  s.buttons[page - 1].setAttribute("aria-pressed", "true");
  s.page = page;
  s.selection++;
  s.mainReady = false;
  main.replaceChildren();
  kick();
}
function mount(s) {
  const fragment = document.createDocumentFragment();
  for (let i = 1; i <= s.doc.pageCount; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "thumbnail";
    b.dataset.page = i;
    b.setAttribute("aria-pressed", String(i === s.page));
    b.innerHTML = `<span class="image"></span><span class="caption">Source p. ${i}</span><span class="source">${s.id}.pdf</span>`;
    b.onclick = () => choose(s, i);
    fragment.append(b);
    s.buttons.push(b);
  }
  pages.replaceChildren(fragment);
  visible(s);
}

async function pump() {
  while (active) {
    const s = active;
    try {
      if (!s.doc) {
        const doc = await documentFor(s.url);
        if (s !== active) continue;
        s.doc = doc;
        mount(s);
      }
      const thumb = s.mainReady, version = s.selection;
      const page = thumb ? [...s.visible].find(p => !s.painted.has(p)) : s.page;
      if (!page) return;
      const target = thumb ? s.buttons[page - 1].firstChild : main;
      const current = () => active === s && (thumb ? s.visible.has(page) : s.selection === version);
      const canvas = document.createElement("canvas");
      await s.doc.render(page, thumb ? 160 : 900, canvas);
      if (!current() || (thumb && !s.mainReady)) continue;
      target.replaceChildren(canvas);
      await frame();
      if (!current() || canvas.parentNode !== target) {
        canvas.remove();
        continue;
      }
      events.push({ id: s.id, page, thumb, t: performance.now() });
      if (thumb) s.painted.add(page);
      else s.mainReady = true;
    } catch (err) {
      if (active !== s) continue;
      failure = `${err?.stack || err}`;
      $("#error").textContent = failure;
      return;
    }
  }
}
function kick() {
  if (busy || failure) return;
  busy = true;
  // pump() has a single owner, including while the previous packet is closing.
  pump().finally(() => { busy = false; });
}
function refresh() {
  if (active?.doc) { visible(active); kick(); }
}
sidebar.addEventListener("scroll", refresh);
window.addEventListener("resize", refresh);
function leave() {
  active = undefined;
  failure = "";
  $("#error").textContent = "";
  events.length = 0;
  main.replaceChildren();
  pages.replaceChildren();
  $("#packet").hidden = true;
  $("#picker").hidden = false;
}
function open(id) {
  if (!/^(p25|p250|m(?:[1-9]|10))$/.test(id)) throw Error("Invalid packet ID");
  leave();
  $("#packet").hidden = false;
  $("#picker").hidden = true;
  sidebar.scrollTop = 0;
  active = { id, url: `/fixtures/${id}.pdf`, page: 1, selection: 0,
    doc: null, mainReady: false, visible: new Set(), painted: new Set(), buttons: [] };
  kick();
}
$("#close").onclick = leave;
document.querySelectorAll("[data-open]").forEach(b => b.onclick = () => open(b.dataset.open));
window.bench = {
  open, leave, events,
  select(page) {
    const b = active?.buttons[page - 1];
    if (!b) throw Error(`Invalid page: ${page}`);
    b.click();
  },
  status: () => ({ engine, busy, failure, limit, keys: [...cache.keys()],
    visible: active?.visible.size || 0, painted: active?.painted.size || 0,
    pageCount: active?.doc?.pageCount || 0, mainReady: !!active?.mainReady }),
};

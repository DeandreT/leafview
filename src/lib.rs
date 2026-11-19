use hayro::hayro_interpret::util::TransformExt;
use hayro::hayro_syntax::Pdf;
use hayro::kurbo::Affine;
use hayro::vello_cpu::color::palette::css::WHITE;
use hayro::vello_cpu::{Pixmap, RasterizerSettings, RenderContext, Resources, TargetInit};
use hayro::{RenderCache, render_into};
use self_cell::self_cell;
use std::cell::RefCell;

// One worker owns one WASM instance and one document. Hayro's cache borrows
// parsed PDF objects; self_cell keeps the PDF at a stable address and drops
// the cache first. No JS handles or leaked objects.
self_cell!(
    struct Document {
        owner: Pdf,
        #[not_covariant]
        dependent: RenderCache,
    }
);

const MAX_BYTES: usize = 64 * 1024 * 1024;
const MAX_PAGES: usize = 250;
const MAX_EDGE: u32 = 8192;
const MAX_PIXELS: u32 = 4_000_000;

thread_local! {
    static INPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static DOC: RefCell<Option<Document>> = const { RefCell::new(None) };
    static FRAME: RefCell<Option<Pixmap>> = const { RefCell::new(None) };
}

// JS writes exactly `len` bytes immediately, before the next WASM call.
#[unsafe(no_mangle)]
pub extern "C" fn input_chunk(len: usize) -> *mut u8 {
    INPUT.with_borrow_mut(|input| {
        let offset = input.len();
        if len == 0 || len > MAX_BYTES - offset {
            return std::ptr::null_mut();
        }
        input.resize(offset + len, 0);
        input[offset..].as_mut_ptr()
    })
}

// Positive: page count. Negative: error codes shared with wasm-worker.js.
#[unsafe(no_mangle)]
pub extern "C" fn open_pdf() -> i32 {
    let bytes = INPUT.take();
    let Ok(pdf) = Pdf::new(bytes) else { return -1 };
    let count = pdf.pages().len();
    if !(1..=MAX_PAGES).contains(&count) {
        return -2;
    }
    DOC.set(Some(Document::new(pdf, |_| RenderCache::new())));
    count as i32
}

// Positive: actual frame height. Render using the rotated crop box and
// Hayro's initial transform (origin, axis flip, user units, page rotation).
#[unsafe(no_mangle)]
pub extern "C" fn render_page(number: u32, width: u32) -> i32 {
    if width == 0 || width > MAX_EDGE {
        return -4;
    }
    DOC.with_borrow(|doc| {
        let Some(doc) = doc else { return -3 };
        doc.with_dependent(|pdf, cache| {
            let Some(page) = pdf.pages().get(number.wrapping_sub(1) as usize) else {
                return -3;
            };
            let (pw, ph) = page.render_dimensions();
            if !(pw.is_finite() && ph.is_finite() && pw > 0.0 && ph > 0.0) {
                return -4;
            }
            let scale = f64::from(width) / f64::from(pw);
            let height = (f64::from(ph) * scale).round().max(1.0);
            if height > f64::from(MAX_EDGE) || width * (height as u32) > MAX_PIXELS {
                return -4;
            }
            let (w, h) = (width as u16, height as u16);
            let mut ctx = RenderContext::new(w, h);
            let transform = Affine::scale(scale) * page.initial_transform(true).to_kurbo();
            render_into(
                page,
                cache,
                &Default::default(),
                &Default::default(),
                &mut ctx,
                transform,
            );
            ctx.flush();
            let mut pixmap = Pixmap::new(w, h);
            ctx.render_with(
                &mut pixmap,
                &mut Resources::default(),
                RasterizerSettings {
                    target_init: TargetInit::Clear(WHITE),
                    ..Default::default()
                },
            );
            FRAME.set(Some(pixmap));
            i32::from(h)
        })
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pixels() -> *const u8 {
    FRAME.with_borrow(|frame| {
        frame
            .as_ref()
            .map_or(std::ptr::null(), |p| p.data_as_u8_slice().as_ptr())
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn release_pixels() {
    FRAME.set(None);
}

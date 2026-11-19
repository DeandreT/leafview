#[link(wasm_import_module = "leafview")]
unsafe extern "C" {
    fn copy_asset(id: u32, dst: *mut u8, len: usize, crc32: u32);
}

/// The import is synchronous, confined to this document's dedicated worker.
/// The worker validates the response before writing it or throws (fatal to this instance).
pub fn load(id: u32, len: usize, crc32: u32) -> Vec<u8> {
    let mut bytes = vec![0; len];
    // SAFETY: the trusted host writes exactly len bytes to this live allocation,
    // never retains dst and never re-enters the instance during the copy.
    unsafe { copy_asset(id, bytes.as_mut_ptr(), len, crc32) };
    bytes
}

/// The pdfium shared library embedded at compile time.
///
/// On first use, these bytes are extracted to the local cache
/// directory; see [`super::bind_bundled`].
pub static PDFIUM_BYTES: &[u8] = include_bytes!("bundled_pdfium_lib");

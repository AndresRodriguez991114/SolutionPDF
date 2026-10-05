use pdfium_bundled::pdfium_render::prelude::{PdfRenderConfig, Pdfium};
use std::{
    ffi::c_void,
    ptr::{copy_nonoverlapping, null_mut},
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex, OnceLock,
    },
};
use windows_sys::Win32::Graphics::Gdi::{
    CreateDIBSection, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
};

static PDFIUM: OnceLock<Result<Pdfium, String>> = OnceLock::new();

fn shared_pdfium() -> Result<&'static Pdfium, String> {
    match PDFIUM.get_or_init(|| pdfium_bundled::bind_bundled().map_err(|error| error.to_string())) {
        Ok(pdfium) => Ok(pdfium),
        Err(error) => Err(error.clone()),
    }
}

pub fn render_first_page(bytes: &[u8], max_size: u32) -> Result<(u32, u32, Vec<u8>), String> {
    if max_size == 0 {
        return Err("El tamaño de miniatura no es válido.".into());
    }

    let pdfium = shared_pdfium()?;
    let document = pdfium
        .load_pdf_from_byte_vec(bytes.to_vec(), None)
        .map_err(|error| error.to_string())?;
    let page = document.pages().get(0).map_err(|error| error.to_string())?;
    let target_size = max_size.min(i32::MAX as u32) as i32;
    let config = PdfRenderConfig::new()
        .set_target_width(target_size)
        .set_maximum_height(target_size);
    let image = page
        .render_with_config(&config)
        .map_err(|error| error.to_string())?
        .as_image()
        .map_err(|error| error.to_string())?
        .to_rgba8();
    let (width, height) = image.dimensions();
    let mut pixels = image.into_raw();

    for pixel in pixels.chunks_exact_mut(4) {
        pixel.swap(0, 2);
        pixel[3] = 255;
    }

    Ok((width, height, pixels))
}

const S_OK: i32 = 0;
const S_FALSE: i32 = 1;
const E_NOINTERFACE: i32 = 0x80004002_u32 as i32;
const E_POINTER: i32 = 0x80004003_u32 as i32;
const E_FAIL: i32 = 0x80004005_u32 as i32;
const CLASS_E_NOAGGREGATION: i32 = 0x80040110_u32 as i32;
const CLASS_E_CLASSNOTAVAILABLE: i32 = 0x80040111_u32 as i32;
const WTSAT_RGB: u32 = 1;
const MAX_PDF_BYTES: usize = 128 * 1024 * 1024;

#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Guid {
    data1: u32,
    data2: u16,
    data3: u16,
    data4: [u8; 8],
}

const IID_IUNKNOWN: Guid = Guid {
    data1: 0,
    data2: 0,
    data3: 0,
    data4: [0xC0, 0, 0, 0, 0, 0, 0, 0x46],
};
const IID_ICLASS_FACTORY: Guid = Guid {
    data1: 1,
    data2: 0,
    data3: 0,
    data4: [0xC0, 0, 0, 0, 0, 0, 0, 0x46],
};
const IID_INITIALIZE_WITH_STREAM: Guid = Guid {
    data1: 0xB824B49D,
    data2: 0x22AC,
    data3: 0x4161,
    data4: [0xAC, 0x8A, 0x99, 0x16, 0xE8, 0xFA, 0x3F, 0x7F],
};
const IID_THUMBNAIL_PROVIDER: Guid = Guid {
    data1: 0xE357FCCD,
    data2: 0xA995,
    data3: 0x4576,
    data4: [0xB0, 0x1F, 0x23, 0x46, 0x30, 0x15, 0x4E, 0x96],
};
const CLSID_PDF_THUMBNAIL_PROVIDER: Guid = Guid {
    data1: 0x3E4A0E76,
    data2: 0xC94E,
    data3: 0x4BC2,
    data4: [0xA2, 0x1C, 0x85, 0xB4, 0x78, 0x09, 0x43, 0x71],
};

type QueryInterfaceFn =
    unsafe extern "system" fn(*mut c_void, *const Guid, *mut *mut c_void) -> i32;
type AddRefFn = unsafe extern "system" fn(*mut c_void) -> u32;
type ReleaseFn = unsafe extern "system" fn(*mut c_void) -> u32;

#[repr(C)]
struct InitVTable {
    query_interface: QueryInterfaceFn,
    add_ref: AddRefFn,
    release: ReleaseFn,
    initialize: unsafe extern "system" fn(*mut InitInterface, *mut IStream, u32) -> i32,
}

#[repr(C)]
struct ThumbnailVTable {
    query_interface: QueryInterfaceFn,
    add_ref: AddRefFn,
    release: ReleaseFn,
    get_thumbnail:
        unsafe extern "system" fn(*mut ThumbnailInterface, u32, *mut isize, *mut u32) -> i32,
}

#[repr(C)]
struct InitInterface {
    vtable: *const InitVTable,
    owner: *mut ThumbnailProvider,
}

#[repr(C)]
struct ThumbnailInterface {
    vtable: *const ThumbnailVTable,
    owner: *mut ThumbnailProvider,
}

#[repr(C)]
struct ThumbnailProvider {
    initialize: InitInterface,
    thumbnail: ThumbnailInterface,
    references: AtomicU32,
    stream: Mutex<*mut IStream>,
}

#[repr(C)]
struct IStream {
    vtable: *const IStreamVTable,
}

#[repr(C)]
struct IStreamVTable {
    query_interface: QueryInterfaceFn,
    add_ref: AddRefFn,
    release: ReleaseFn,
    read: unsafe extern "system" fn(*mut IStream, *mut c_void, u32, *mut u32) -> i32,
    write: usize,
    seek: unsafe extern "system" fn(*mut IStream, i64, u32, *mut u64) -> i32,
}

static INIT_VTABLE: InitVTable = InitVTable {
    query_interface: provider_query_interface,
    add_ref: provider_add_ref,
    release: provider_release,
    initialize: provider_initialize,
};
static THUMBNAIL_VTABLE: ThumbnailVTable = ThumbnailVTable {
    query_interface: thumbnail_query_interface,
    add_ref: thumbnail_add_ref,
    release: thumbnail_release,
    get_thumbnail: provider_get_thumbnail,
};
static ACTIVE_PROVIDERS: AtomicU32 = AtomicU32::new(0);

impl Drop for ThumbnailProvider {
    fn drop(&mut self) {
        ACTIVE_PROVIDERS.fetch_sub(1, Ordering::Release);
        let stream = *self
            .stream
            .get_mut()
            .unwrap_or_else(|error| error.into_inner());
        if !stream.is_null() {
            unsafe { ((*(*stream).vtable).release)(stream.cast()) };
        }
    }
}

unsafe fn provider_from_init(this: *mut InitInterface) -> *mut ThumbnailProvider {
    (*this).owner
}

unsafe fn provider_from_thumbnail(this: *mut ThumbnailInterface) -> *mut ThumbnailProvider {
    (*this).owner
}

unsafe extern "system" fn provider_query_interface(
    this: *mut c_void,
    iid: *const Guid,
    result: *mut *mut c_void,
) -> i32 {
    if iid.is_null() || result.is_null() {
        return E_POINTER;
    }
    let interface = this.cast::<InitInterface>();
    let provider = provider_from_init(interface);
    if *iid == IID_IUNKNOWN || *iid == IID_INITIALIZE_WITH_STREAM {
        *result = interface.cast();
    } else if *iid == IID_THUMBNAIL_PROVIDER {
        *result = (&mut (*provider).thumbnail as *mut ThumbnailInterface).cast();
    } else {
        *result = null_mut();
        return E_NOINTERFACE;
    }
    provider_add_ref(interface.cast());
    S_OK
}

unsafe extern "system" fn thumbnail_query_interface(
    this: *mut c_void,
    iid: *const Guid,
    result: *mut *mut c_void,
) -> i32 {
    if this.is_null() {
        return E_POINTER;
    }
    let provider = provider_from_thumbnail(this.cast());
    provider_query_interface(
        (&mut (*provider).initialize as *mut InitInterface).cast(),
        iid,
        result,
    )
}

unsafe extern "system" fn provider_add_ref(this: *mut c_void) -> u32 {
    let provider = provider_from_init(this.cast());
    (*provider).references.fetch_add(1, Ordering::Relaxed) + 1
}

unsafe extern "system" fn thumbnail_add_ref(this: *mut c_void) -> u32 {
    let provider = provider_from_thumbnail(this.cast());
    (*provider).references.fetch_add(1, Ordering::Relaxed) + 1
}

unsafe extern "system" fn provider_release(this: *mut c_void) -> u32 {
    release_provider(provider_from_init(this.cast()))
}

unsafe extern "system" fn thumbnail_release(this: *mut c_void) -> u32 {
    release_provider(provider_from_thumbnail(this.cast()))
}

unsafe fn release_provider(provider: *mut ThumbnailProvider) -> u32 {
    let remaining = (*provider).references.fetch_sub(1, Ordering::Release) - 1;
    if remaining == 0 {
        std::sync::atomic::fence(Ordering::Acquire);
        drop(Box::from_raw(provider));
    }
    remaining
}

unsafe extern "system" fn provider_initialize(
    this: *mut InitInterface,
    stream: *mut IStream,
    _mode: u32,
) -> i32 {
    if this.is_null() || stream.is_null() {
        return E_POINTER;
    }
    let provider = provider_from_init(this);
    let mut current = match (*provider).stream.lock() {
        Ok(stream) => stream,
        Err(_) => return E_FAIL,
    };
    ((*(*stream).vtable).add_ref)(stream.cast());
    let previous_stream = *current;
    if !previous_stream.is_null() {
        ((*(*previous_stream).vtable).release)(previous_stream.cast());
    }
    *current = stream;
    S_OK
}

unsafe fn read_stream(stream: *mut IStream) -> Result<Vec<u8>, i32> {
    let vtable = &*(*stream).vtable;
    let mut position = 0;
    let seek_result = (vtable.seek)(stream, 0, 0, &mut position);
    if seek_result < 0 {
        return Err(seek_result);
    }

    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let mut read = 0;
        let result = (vtable.read)(
            stream,
            buffer.as_mut_ptr().cast(),
            buffer.len() as u32,
            &mut read,
        );
        if result < 0 {
            return Err(result);
        }
        if read == 0 {
            break;
        }
        if bytes.len().saturating_add(read as usize) > MAX_PDF_BYTES {
            return Err(E_FAIL);
        }
        bytes.extend_from_slice(&buffer[..read as usize]);
    }
    Ok(bytes)
}

unsafe extern "system" fn provider_get_thumbnail(
    this: *mut ThumbnailInterface,
    size: u32,
    bitmap: *mut isize,
    alpha_type: *mut u32,
) -> i32 {
    if this.is_null() || bitmap.is_null() || alpha_type.is_null() {
        return E_POINTER;
    }
    *bitmap = 0;
    let provider = provider_from_thumbnail(this);
    let stream = match (*provider).stream.lock() {
        Ok(stream) => *stream,
        Err(_) => return E_FAIL,
    };
    if stream.is_null() || size == 0 {
        return E_FAIL;
    }
    let bytes = match read_stream(stream) {
        Ok(bytes) => bytes,
        Err(error) => return error,
    };
    let (width, height, pixels) = match render_first_page(&bytes, size.min(1024)) {
        Ok(rendered) => rendered,
        Err(_) => return E_FAIL,
    };
    match create_thumbnail_bitmap(width, height, &pixels) {
        Ok(handle) => {
            *bitmap = handle;
            *alpha_type = WTSAT_RGB;
            S_OK
        }
        Err(error) => error,
    }
}

fn create_thumbnail_bitmap(width: u32, height: u32, pixels: &[u8]) -> Result<isize, i32> {
    if width == 0 || height == 0 || width > i32::MAX as u32 || height > i32::MAX as u32 {
        return Err(E_FAIL);
    }
    let mut info = BITMAPINFO::default();
    info.bmiHeader = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: width as i32,
        biHeight: -(height as i32),
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB,
        biSizeImage: (width * height * 4) as u32,
        ..Default::default()
    };
    let mut bits = null_mut();
    let bitmap =
        unsafe { CreateDIBSection(null_mut(), &info, DIB_RGB_COLORS, &mut bits, null_mut(), 0) };
    if bitmap.is_null() || bits.is_null() {
        return Err(E_FAIL);
    }
    unsafe { copy_nonoverlapping(pixels.as_ptr(), bits.cast::<u8>(), pixels.len()) };
    Ok(bitmap as isize)
}

#[repr(C)]
struct ClassFactoryVTable {
    query_interface: QueryInterfaceFn,
    add_ref: AddRefFn,
    release: ReleaseFn,
    create_instance: unsafe extern "system" fn(
        *mut ClassFactory,
        *mut c_void,
        *const Guid,
        *mut *mut c_void,
    ) -> i32,
    lock_server: unsafe extern "system" fn(*mut ClassFactory, i32) -> i32,
}

#[repr(C)]
struct ClassFactory {
    vtable: *const ClassFactoryVTable,
    references: AtomicU32,
}

unsafe impl Sync for ClassFactory {}

static CLASS_FACTORY_VTABLE: ClassFactoryVTable = ClassFactoryVTable {
    query_interface: factory_query_interface,
    add_ref: factory_add_ref,
    release: factory_release,
    create_instance: factory_create_instance,
    lock_server: factory_lock_server,
};
static CLASS_FACTORY: ClassFactory = ClassFactory {
    vtable: &CLASS_FACTORY_VTABLE,
    references: AtomicU32::new(1),
};

unsafe extern "system" fn factory_query_interface(
    this: *mut c_void,
    iid: *const Guid,
    result: *mut *mut c_void,
) -> i32 {
    if iid.is_null() || result.is_null() {
        return E_POINTER;
    }
    if *iid != IID_IUNKNOWN && *iid != IID_ICLASS_FACTORY {
        *result = null_mut();
        return E_NOINTERFACE;
    }
    *result = this;
    factory_add_ref(this);
    S_OK
}

unsafe extern "system" fn factory_add_ref(this: *mut c_void) -> u32 {
    (*this.cast::<ClassFactory>())
        .references
        .fetch_add(1, Ordering::Relaxed)
        + 1
}

unsafe extern "system" fn factory_release(this: *mut c_void) -> u32 {
    (*this.cast::<ClassFactory>())
        .references
        .fetch_sub(1, Ordering::Relaxed)
        - 1
}

unsafe extern "system" fn factory_create_instance(
    _this: *mut ClassFactory,
    outer: *mut c_void,
    iid: *const Guid,
    result: *mut *mut c_void,
) -> i32 {
    if iid.is_null() || result.is_null() {
        return E_POINTER;
    }
    *result = null_mut();
    if !outer.is_null() {
        return CLASS_E_NOAGGREGATION;
    }
    let mut provider = Box::new(ThumbnailProvider {
        initialize: InitInterface {
            vtable: &INIT_VTABLE,
            owner: null_mut(),
        },
        thumbnail: ThumbnailInterface {
            vtable: &THUMBNAIL_VTABLE,
            owner: null_mut(),
        },
        references: AtomicU32::new(1),
        stream: Mutex::new(null_mut()),
    });
    let provider_ptr = &mut *provider as *mut ThumbnailProvider;
    provider.initialize.owner = provider_ptr;
    provider.thumbnail.owner = provider_ptr;
    ACTIVE_PROVIDERS.fetch_add(1, Ordering::Relaxed);
    let provider_ptr = Box::into_raw(provider);
    let initialize = &mut (*provider_ptr).initialize as *mut InitInterface;
    let query_result = provider_query_interface(initialize.cast(), iid, result);
    provider_release(initialize.cast());
    query_result
}

unsafe extern "system" fn factory_lock_server(_this: *mut ClassFactory, _lock: i32) -> i32 {
    S_OK
}

#[no_mangle]
pub unsafe extern "system" fn DllGetClassObject(
    class_id: *const Guid,
    iid: *const Guid,
    result: *mut *mut c_void,
) -> i32 {
    if class_id.is_null() || iid.is_null() || result.is_null() {
        return E_POINTER;
    }
    if *class_id != CLSID_PDF_THUMBNAIL_PROVIDER {
        *result = null_mut();
        return CLASS_E_CLASSNOTAVAILABLE;
    }
    factory_query_interface(
        (&CLASS_FACTORY as *const ClassFactory).cast_mut().cast(),
        iid,
        result,
    )
}

#[no_mangle]
pub extern "system" fn DllCanUnloadNow() -> i32 {
    if ACTIVE_PROVIDERS.load(Ordering::Acquire) == 0
        && CLASS_FACTORY.references.load(Ordering::Acquire) == 1
    {
        S_OK
    } else {
        S_FALSE
    }
}

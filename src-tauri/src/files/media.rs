//! Token-only media access. No full-file allocation or text decoding; the
//! version string uses only bounded metadata and first/last-4 KiB samples.
use super::*;
use sha2::{Digest, Sha256};
use std::io::{Seek, SeekFrom};

pub const CHUNK_BYTES: usize = 256 * 1024;
const HEADER_BYTES: u64 = 4096;
pub(crate) fn is_media_content(bytes: &[u8]) -> bool {
    signature(&bytes[..bytes.len().min(HEADER_BYTES as usize)]).is_some()
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaMetadata {
    pub byte_length: u64,
    pub mime: String,
    pub format: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

fn raster_dimensions(file: &mut fs::File, header: &[u8], mime: &str) -> Option<(u32, u32)> {
    if mime == "image/x-icon" {
        let count = u16::from_le_bytes(header.get(4..6)?.try_into().ok()?) as usize;
        if count == 0 || count > 256 {
            return None;
        }
        let file_length = file.metadata().ok()?.len();
        let mut size = (0, 0);
        for index in 0..count {
            file.seek(SeekFrom::Start(6 + index as u64 * 16)).ok()?;
            let mut entry = [0; 16];
            file.read_exact(&mut entry).ok()?;
            let length = u32::from_le_bytes(entry[8..12].try_into().ok()?) as u64;
            let offset = u32::from_le_bytes(entry[12..16].try_into().ok()?) as u64;
            if length == 0
                || offset < 6 + count as u64 * 16
                || offset.checked_add(length)? > file_length
            {
                return None;
            }
            let declared = (
                if entry[0] == 0 { 256 } else { entry[0] as u32 },
                if entry[1] == 0 { 256 } else { entry[1] as u32 },
            );
            // Embedded PNG dimensions can differ from the icon directory. Check both before decoding.
            file.seek(SeekFrom::Start(offset)).ok()?;
            let mut content = vec![0; length.min(32) as usize];
            file.read_exact(&mut content).ok()?;
            let actual = if content.starts_with(b"\x89PNG\r\n\x1a\n") {
                images::dimensions(&content)?
            } else if content.len() >= 12 && u32::from_le_bytes(content[..4].try_into().ok()?) >= 40
            {
                (
                    i32::from_le_bytes(content[4..8].try_into().ok()?).unsigned_abs(),
                    i32::from_le_bytes(content[8..12].try_into().ok()?).unsigned_abs() / 2,
                )
            } else {
                declared
            };
            size.0 = size.0.max(actual.0).max(declared.0);
            size.1 = size.1.max(actual.1).max(declared.1);
        }
        return Some(size);
    }
    if mime == "image/bmp" {
        let dib = u32::from_le_bytes(header.get(14..18)?.try_into().ok()?);
        return if dib == 12 {
            Some((
                u16::from_le_bytes(header.get(18..20)?.try_into().ok()?) as u32,
                u16::from_le_bytes(header.get(20..22)?.try_into().ok()?) as u32,
            ))
        } else {
            Some((
                i32::from_le_bytes(header.get(18..22)?.try_into().ok()?).unsigned_abs(),
                i32::from_le_bytes(header.get(22..26)?.try_into().ok()?).unsigned_abs(),
            ))
        };
    }
    if mime == "image/jpeg" {
        // Walk JPEG segments with seeks: a large EXIF/profile must not require a large header allocation.
        file.seek(SeekFrom::Start(2)).ok()?;
        for _ in 0..4096 {
            let mut pair = [0; 2];
            file.read_exact(&mut pair).ok()?;
            if pair[0] != 0xff {
                return None;
            }
            while pair[1] == 0xff {
                file.read_exact(&mut pair[1..]).ok()?;
            }
            let marker = pair[1];
            if marker == 0xda || marker == 0xd9 {
                return None;
            }
            if marker == 1 || (0xd0..=0xd7).contains(&marker) {
                continue;
            }
            file.read_exact(&mut pair).ok()?;
            let length = u16::from_be_bytes(pair) as i64;
            if length < 2 {
                return None;
            }
            if [
                0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
            ]
            .contains(&marker)
            {
                let mut dimensions = [0; 5];
                file.read_exact(&mut dimensions).ok()?;
                return Some((
                    u16::from_be_bytes([dimensions[3], dimensions[4]]) as u32,
                    u16::from_be_bytes([dimensions[1], dimensions[2]]) as u32,
                ));
            }
            file.seek(SeekFrom::Current(length - 2)).ok()?;
        }
        return None;
    }
    images::dimensions(header)
}

fn signature(bytes: &[u8]) -> Option<(FileKind, &'static str, &'static str)> {
    let image = |mime, format| Some((FileKind::Image, mime, format));
    if bytes.starts_with(b"%PDF-") {
        return Some((FileKind::Pdf, "application/pdf", "PDF"));
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return image("image/png", "PNG");
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return image("image/jpeg", "JPEG");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return image("image/gif", "GIF");
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        return image("image/webp", "WebP");
    }
    if bytes.starts_with(b"BM") {
        return image("image/bmp", "BMP");
    }
    if bytes.starts_with(b"\0\0\x01\0") {
        return image("image/x-icon", "ICO");
    }
    if bytes.starts_with(b"\0\0\x02\0") {
        return image("image/x-icon", "CUR");
    }
    if bytes.get(4..8) == Some(b"ftyp") {
        let length = u32::from_be_bytes(bytes.get(..4)?.try_into().ok()?) as usize;
        if length >= 16
            && length <= bytes.len()
            && (bytes.get(8..12) == Some(b"avif")
                || bytes.get(8..12) == Some(b"avis")
                || bytes
                    .get(16..length)?
                    .as_chunks::<4>()
                    .0
                    .iter()
                    .any(|b| b == b"avif" || b == b"avis"))
        {
            return image("image/avif", "AVIF");
        }
    }
    // SVG is ONLY ever used as an <img> blob. Never as markup, an object or an iframe.
    {
        // The bounded header may end inside a UTF-8 character; don't reject an otherwise valid SVG.
        let text = String::from_utf8_lossy(bytes);
        let text = text.trim_start_matches('\u{feff}').trim_start();
        if (text.starts_with("<svg") || text.starts_with("<?xml") || text.starts_with("<!--"))
            && regex::Regex::new(r"(?s)<svg(?:\s|>)")
                .unwrap()
                .is_match(text)
        {
            return image("image/svg+xml", "SVG");
        }
    }
    None
}

fn version(file: &mut fs::File, meta: &fs::Metadata) -> Result<String> {
    let modified = system_time_nanos(meta.modified());
    let created = system_time_nanos(meta.created());
    let changed = changed_time(file, meta)?;
    Ok(format!(
        "media-{}-{modified}-{created}-{changed}-{}-{}",
        meta.len(),
        identity(file, meta)?,
        content_fingerprint(file, meta.len())?
    ))
}

fn system_time_nanos(time: std::io::Result<std::time::SystemTime>) -> u128 {
    time.ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|t| t.as_nanos())
        .unwrap_or(0)
}

/// Native identity of the opened handle. A different file at the same path must
/// invalidate a viewer even when length and modification time were reproduced.
/// Routing (`FileService::file_identity`) and media previews share the Windows
/// volume+index helper; the media string additionally carries change evidence.
fn identity(file: &fs::File, meta: &fs::Metadata) -> Result<String> {
    #[cfg(windows)]
    {
        let _ = meta;
        Ok(match super::file_identity_from_handle(file) {
            Some(identity) => format!("{:x}:{:x}", identity.volume, identity.index),
            None => "identity-unavailable".into(),
        })
    }
    #[cfg(unix)]
    {
        let _ = file;
        use std::os::unix::fs::MetadataExt;
        Ok(format!("{:x}:{:x}", meta.dev(), meta.ino()))
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = (file, meta);
        Ok("identity-unavailable".into())
    }
}

/// Extra native change timestamp: Unix ctime, Windows ChangeTime. ctime cannot
/// be set by ordinary user code, so it distinguishes a replacement from an
/// in-place write even when length and mtime were deliberately reproduced.
fn changed_time(file: &fs::File, meta: &fs::Metadata) -> Result<String> {
    #[cfg(windows)]
    {
        let _ = meta;
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            FileBasicInfo, GetFileInformationByHandleEx, FILE_BASIC_INFO,
        };
        let mut info: FILE_BASIC_INFO = unsafe { std::mem::zeroed() };
        let ok = unsafe {
            GetFileInformationByHandleEx(
                file.as_raw_handle() as _,
                FileBasicInfo,
                &mut info as *mut _ as *mut _,
                std::mem::size_of::<FILE_BASIC_INFO>() as u32,
            )
        };
        if ok == 0 {
            // A readable preview must not fail only because an optional change
            // timestamp is unavailable; identity and the content sample remain.
            Ok("change-unavailable".into())
        } else {
            Ok(format!("{:x}", info.ChangeTime as u64))
        }
    }
    #[cfg(unix)]
    {
        let _ = file;
        use std::os::unix::fs::MetadataExt;
        Ok(format!("{}-{}", meta.ctime(), meta.ctime_nsec()))
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = (file, meta);
        Ok("change-unavailable".into())
    }
}

/// Bounded content sample: first and last 4 KiB. It catches inode/timestamp
/// reuse that metadata alone cannot distinguish, without reading a whole file
/// or re-hashing it for every 256 KiB chunk.
const VERSION_SAMPLE_BYTES: usize = 4096;

fn content_fingerprint(file: &mut fs::File, len: u64) -> Result<String> {
    // `seek_read` on Windows advances the shared file cursor (observed), so the
    // original position must be restored before the caller resumes reading.
    let position = file.stream_position().map_err(FileError::io)?;
    let result = (|| -> Result<String> {
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; VERSION_SAMPLE_BYTES];
        let prefix_len = len.min(VERSION_SAMPLE_BYTES as u64) as usize;
        read_sample(file, &mut buffer[..prefix_len], 0)?;
        hasher.update(b"head");
        hasher.update((prefix_len as u64).to_le_bytes());
        hasher.update(&buffer[..prefix_len]);

        if len > VERSION_SAMPLE_BYTES as u64 {
            let suffix_len =
                (len - VERSION_SAMPLE_BYTES as u64).min(VERSION_SAMPLE_BYTES as u64) as usize;
            let offset = len - suffix_len as u64;
            read_sample(file, &mut buffer[..suffix_len], offset)?;
            hasher.update(b"tail");
            hasher.update(offset.to_le_bytes());
            hasher.update(&buffer[..suffix_len]);
        }
        Ok(format!("{:x}", hasher.finalize()))
    })();
    file.seek(SeekFrom::Start(position))
        .map_err(FileError::io)?;
    result
}

fn read_sample(file: &mut fs::File, buffer: &mut [u8], offset: u64) -> Result<()> {
    let read = read_at(file, buffer, offset).map_err(FileError::io)?;
    if read != buffer.len() {
        return fail("conflict", "媒体文件在计算版本时发生变化，请重新加载。");
    }
    Ok(())
}

#[cfg(unix)]
fn read_at(file: &fs::File, buffer: &mut [u8], offset: u64) -> std::io::Result<usize> {
    use std::os::unix::fs::FileExt;
    file.read_at(buffer, offset)
}

#[cfg(windows)]
fn read_at(file: &mut fs::File, buffer: &mut [u8], offset: u64) -> std::io::Result<usize> {
    use std::os::windows::fs::FileExt;
    file.seek_read(buffer, offset)
}

#[cfg(not(any(windows, unix)))]
fn read_at(file: &mut fs::File, buffer: &mut [u8], offset: u64) -> std::io::Result<usize> {
    use std::io::{Read, Seek, SeekFrom};
    let mut clone = file.try_clone()?;
    clone.seek(SeekFrom::Start(offset))?;
    clone.read(buffer)
}

fn open(path: &Path) -> Result<fs::File> {
    let file = open_plain_read(path)?;
    let meta = file.metadata().map_err(FileError::io)?;
    if !meta.is_file() {
        return fail("path", "仅允许读取普通媒体文件。");
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        };
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut info) } == 0 {
            return Err(FileError::io(std::io::Error::last_os_error()));
        }
        if info.nNumberOfLinks > 1 {
            return fail("path", "暂不支持硬链接媒体文件。");
        }
    }
    Ok(file)
}

pub(super) fn inspect(path: &Path) -> Result<Option<(FileKind, MediaMetadata, String)>> {
    let mut file = open(path)?;
    let meta = file.metadata().map_err(FileError::io)?;
    let initial_version = version(&mut file, &meta)?;
    let mut header = Vec::new();
    (&mut file)
        .take(HEADER_BYTES)
        .read_to_end(&mut header)
        .map_err(FileError::io)?;
    if let Some((kind, mime, format)) = signature(&header) {
        // JS/PDF.js offsets must be exact integers. Large images also have a frontend decode budget.
        if meta.len() > 2 * 1024 * 1024 * 1024 {
            return fail("size", "媒体文件超过 2 GiB 查看预算，请使用专用程序。");
        }
        let dimensions = if mime == "image/avif" {
            // AVIF's spatial property normally lives in its bounded metadata prefix.
            // Missing metadata is left to the native decoder, just as for dimensionless SVG.
            header.windows(16).find(|b| &b[..4] == b"ispe").map(|b| {
                (
                    u32::from_be_bytes(b[8..12].try_into().unwrap()),
                    u32::from_be_bytes(b[12..16].try_into().unwrap()),
                )
            })
        } else if kind == FileKind::Image && mime != "image/svg+xml" {
            Some(raster_dimensions(&mut file, &header, mime).ok_or_else(|| {
                FileError::new(
                    "image_header",
                    "图片尺寸信息损坏或无法安全识别，请使用系统图片程序。",
                )
            })?)
        } else {
            None
        };
        let final_meta = file.metadata().map_err(FileError::io)?;
        if version(&mut file, &final_meta)? != initial_version {
            return fail("conflict", "读取媒体元数据期间文件发生变化，请重试。");
        }
        Ok(Some((
            kind,
            MediaMetadata {
                byte_length: meta.len(),
                mime: mime.into(),
                format: format.into(),
                width: dimensions.map(|d| d.0),
                height: dimensions.map(|d| d.1),
            },
            initial_version,
        )))
    } else {
        let ext = path
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_ascii_lowercase();
        if [
            "png", "apng", "jpg", "jpeg", "jfif", "pjpeg", "pjp", "gif", "webp", "bmp", "dib",
            "svg", "pdf", "tif", "tiff", "heic", "heif", "avif", "ico", "cur", "svgz", "jxl",
            "psd", "tga",
        ]
        .contains(&ext.as_str())
        {
            return fail("media_type", "文件内容与支持的图片/PDF 格式不符，文件可能损坏或格式尚不支持。可显式选择 Hex 查看字节。");
        }
        Ok(None)
    }
}

impl FileService {
    pub fn media_metadata(&self, token: &str) -> Result<(MediaMetadata, String)> {
        let path = self.validate(token, false)?;
        let (_, meta, version) = inspect(&path)?
            .ok_or_else(|| FileError::new("media_type", "文件已不再是支持的媒体格式。"))?;
        Ok((meta, version))
    }
    pub fn read_media_chunk(
        &self,
        token: &str,
        expected: &str,
        offset: u64,
        length: usize,
    ) -> Result<Vec<u8>> {
        if length == 0 || length > CHUNK_BYTES {
            return fail("range", "媒体读取块必须为 1–256 KiB。");
        }
        let path = self.validate(token, false)?;
        let (meta, actual) = self.media_metadata(token)?;
        if actual != expected {
            return fail("conflict", "文件已被外部修改，请重新加载查看器。");
        }
        if offset > meta.byte_length || length as u64 > meta.byte_length - offset {
            return fail("range", "媒体读取范围越界。");
        }
        let mut file = open(&path)?;
        let opened_meta = file.metadata().map_err(FileError::io)?;
        if version(&mut file, &opened_meta)? != expected {
            return fail("conflict", "文件读取期间发生修改，请重新加载。");
        }
        file.seek(SeekFrom::Start(offset)).map_err(FileError::io)?;
        let mut bytes = vec![0; length];
        file.read_exact(&mut bytes).map_err(FileError::io)?;
        let final_meta = file.metadata().map_err(FileError::io)?;
        if self.validate(token, false)? != path || version(&mut file, &final_meta)? != expected {
            return fail("conflict", "文件读取期间发生修改，请重新加载。");
        }
        Ok(bytes)
    }
    pub fn media_path(&self, token: &str) -> Result<PathBuf> {
        self.media_metadata(token)?;
        self.validate(token, false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keep_identity_handle(path: &Path) -> fs::File {
        let mut options = fs::OpenOptions::new();
        options.read(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            // FILE_SHARE_READ | FILE_SHARE_DELETE: rename/replace the path while
            // this handle keeps the original file identity alive.
            options.share_mode(0x1 | 0x4);
        }
        options.open(path).unwrap()
    }

    fn set_mtime(path: &Path, modified: std::time::SystemTime) {
        let file = fs::OpenOptions::new().write(true).open(path).unwrap();
        file.set_times(fs::FileTimes::new().set_modified(modified))
            .unwrap();
    }

    fn pdf_with_len(len: usize) -> Vec<u8> {
        let mut bytes = b"%PDF-1.7\n".to_vec();
        bytes.resize(len, b' ');
        bytes
    }

    #[cfg(unix)]
    fn native_key(path: &Path) -> String {
        use std::os::unix::fs::MetadataExt;
        let meta = fs::metadata(path).unwrap();
        format!("{:x}:{:x}", meta.dev(), meta.ino())
    }

    #[cfg(windows)]
    fn native_key(path: &Path) -> String {
        crate::files::file_identity(path)
            .map(|identity| format!("{identity:?}"))
            .unwrap_or_default()
    }

    #[cfg(not(any(unix, windows)))]
    fn native_key(_path: &Path) -> String {
        String::new()
    }

    #[test]
    fn token_ranges_and_large_pdf() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("wrong.txt");
        fs::write(&path, b"%PDF-1.7\n").unwrap();
        fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(20 * 1024 * 1024)
            .unwrap();
        let mut service = FileService::default();
        service.set_owner("one");
        let file = service.open_selected(path.clone(), None).unwrap();
        assert_eq!(file.kind, FileKind::Pdf);
        assert!(file.text.is_empty());
        let t = &file.metadata.token;
        let v = &file.metadata.version;
        assert_eq!(service.read_media_chunk(t, v, 0, 5).unwrap(), b"%PDF-");
        assert!(service.read_media_chunk(t, v, 0, CHUNK_BYTES + 1).is_err());
        assert!(service.read_media_chunk(t, v, 20 * 1024 * 1024, 1).is_err());
        assert!(service.read_media_chunk(t, v, u64::MAX, 1).is_err());
        assert!(service.read_media_chunk(t, v, u64::MAX - 1, 2).is_err());
        assert!(service.read_media_chunk(t, v, 0, 0).is_err());
        service.set_owner("two");
        assert!(service.read_media_chunk(t, v, 0, 5).is_err());
        service.set_owner("one");
        fs::write(&path, b"%PDF-1.7\nchanged").unwrap();
        assert!(service.read_media_chunk(t, v, 0, 5).is_err());
        assert!(service.save(t, "overwrite", None, "UTF-8", false).is_err());
        let renamed = dir.path().join("renamed.pdf");
        fs::rename(&path, &renamed).unwrap();
        service.update_grant_path(&path, &renamed);
        assert!(service.media_metadata(t).is_ok());
        fs::remove_file(&renamed).unwrap();
        assert!(service.media_metadata(t).is_err());
        service.release(t);
        assert!(service.media_metadata(t).is_err());
    }
    #[test]
    fn replacing_a_media_file_with_an_identical_size_and_mtime_is_detected() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("document.pdf");
        fs::write(&path, b"%PDF-1.7\n").unwrap();
        let mut service = FileService::default();
        service.set_owner("window-a");
        let opened = service.open_selected(path.clone(), None).unwrap();
        assert_eq!(opened.kind, FileKind::Pdf);
        let token = opened.metadata.token;
        let version = opened.metadata.version;
        let modified = fs::metadata(&path).unwrap().modified().unwrap();

        // A different file with the same length and a restored mtime would keep
        // the old length+mtime version. Keep the original linked and open so no
        // Unix filesystem can reuse its inode for the replacement.
        let old_handle = keep_identity_handle(&path);
        let original = directory.path().join("original.pdf");
        fs::rename(&path, &original).unwrap();
        fs::write(&path, b"%PDF-2.0\n").unwrap();
        let file = fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_times(std::fs::FileTimes::new().set_modified(modified))
            .unwrap();
        drop(file);
        let replacement_meta = fs::metadata(&path).unwrap();
        assert_eq!(
            replacement_meta.len(),
            fs::metadata(&original).unwrap().len()
        );
        assert_eq!(replacement_meta.modified().unwrap(), modified);
        #[cfg(windows)]
        assert_ne!(
            crate::files::file_identity_from_handle(&old_handle),
            crate::files::file_identity(&path)
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            assert_ne!(old_handle.metadata().unwrap().ino(), replacement_meta.ino());
        }
        let error = service
            .read_media_chunk(&token, &version, 0, 5)
            .unwrap_err();
        assert_eq!(error.code, "conflict");
        drop(old_handle);
    }

    #[test]
    fn delete_then_immediate_recreate_with_same_size_and_mtime_is_detected() {
        let directory = tempfile::tempdir().unwrap();
        let mut service = FileService::default();
        service.set_owner("window-a");
        let mut inode_reused = false;
        for attempt in 0..64 {
            let path = directory.path().join(format!("recreate-{attempt}.pdf"));
            fs::write(&path, b"%PDF-1.7\n").unwrap();
            let modified = fs::metadata(&path).unwrap().modified().unwrap();
            let before = native_key(&path);
            let opened = service.open_selected(path.clone(), None).unwrap();
            let token = opened.metadata.token;
            let version = opened.metadata.version;

            fs::remove_file(&path).unwrap();
            fs::write(&path, b"%PDF-2.0\n").unwrap();
            set_mtime(&path, modified);
            let after = native_key(&path);
            let mtime_preserved = fs::metadata(&path).unwrap().modified().unwrap() == modified;
            let legacy_collision = !before.is_empty() && before == after && mtime_preserved;
            if !before.is_empty() && before == after {
                inode_reused = true;
            }
            let error = service
                .read_media_chunk(&token, &version, 0, 5)
                .unwrap_err();
            assert_eq!(
                error.code, "conflict",
                "attempt {attempt}: inode_reused={inode_reused}"
            );
            service.release(&token);
            if inode_reused {
                eprintln!(
                    "delete/recreate native identity reused=true legacy_metadata_collision={legacy_collision}"
                );
                break;
            }
        }
        // The assertion above is valid whether or not the filesystem reused the
        // inode; this line records the observed case for `--nocapture` runs.
        eprintln!("delete/recreate native identity reused={inode_reused}");
    }

    #[test]
    #[allow(clippy::permissions_set_readonly_false)]
    fn chunk_boundaries_and_read_only_preview_remain_valid() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("large.pdf");
        let bytes = pdf_with_len(CHUNK_BYTES * 2 + 1234);
        fs::write(&path, &bytes).unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&path, permissions).unwrap();

        let mut service = FileService::default();
        service.set_owner("window-a");
        let opened = service.open_selected(path.clone(), None).unwrap();
        let token = opened.metadata.token;
        let version = opened.metadata.version;
        let mut read = Vec::new();
        let mut offset = 0usize;
        while offset < bytes.len() {
            let length = (bytes.len() - offset).min(CHUNK_BYTES);
            read.extend_from_slice(
                &service
                    .read_media_chunk(&token, &version, offset as u64, length)
                    .unwrap(),
            );
            offset += length;
        }
        assert_eq!(read, bytes);
        assert!(service.read_media_chunk(&token, &version, 0, 0).is_err());
        assert!(service
            .read_media_chunk(&token, &version, 0, CHUNK_BYTES + 1)
            .is_err());
        let last = bytes.len() as u64 - 1;
        assert_eq!(
            service.read_media_chunk(&token, &version, last, 1).unwrap(),
            vec![b' ']
        );
        assert!(service.read_media_chunk(&token, &version, last, 2).is_err());
        assert!(service
            .read_media_chunk(&token, &version, bytes.len() as u64, 1)
            .is_err());
        service.release(&token);

        #[cfg(windows)]
        {
            let mut permissions = fs::metadata(&path).unwrap().permissions();
            permissions.set_readonly(false);
            fs::set_permissions(&path, permissions).unwrap();
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        }
    }

    #[test]
    fn deleted_directory_symlink_modified_and_released_media_are_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("document.pdf");
        fs::write(&path, b"%PDF-1.7\n").unwrap();
        let mut service = FileService::default();
        service.set_owner("window-a");
        let opened = service.open_selected(path.clone(), None).unwrap();
        let token = opened.metadata.token;
        let version = opened.metadata.version;
        let modified = fs::metadata(&path).unwrap().modified().unwrap();

        // Same size and mtime, different bytes: the sampled fingerprint and the
        // native change timestamp must force a conflict.
        fs::write(&path, b"%PDF-9.9\n").unwrap();
        set_mtime(&path, modified);
        let conflict = service
            .read_media_chunk(&token, &version, 0, 5)
            .unwrap_err();
        assert_eq!(conflict.code, "conflict");

        fs::remove_file(&path).unwrap();
        assert!(service.read_media_chunk(&token, &version, 0, 5).is_err());
        fs::create_dir(&path).unwrap();
        assert!(service.read_media_chunk(&token, &version, 0, 5).is_err());
        fs::remove_dir(&path).unwrap();

        #[cfg(unix)]
        {
            let target = directory.path().join("target.pdf");
            fs::write(&target, b"%PDF-1.7\n").unwrap();
            std::os::unix::fs::symlink(&target, &path).unwrap();
            assert!(service.read_media_chunk(&token, &version, 0, 5).is_err());
            fs::remove_file(&path).unwrap();
        }

        service.release(&token);
        assert!(service.read_media_chunk(&token, &version, 0, 5).is_err());
    }

    #[test]
    fn truncation_during_a_view_is_reported_as_a_conflict() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("large.pdf");
        fs::write(&path, pdf_with_len(CHUNK_BYTES * 2)).unwrap();
        let mut service = FileService::default();
        service.set_owner("window-a");
        let opened = service.open_selected(path.clone(), None).unwrap();
        let token = opened.metadata.token;
        let version = opened.metadata.version;
        fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(128)
            .unwrap();
        let error = service
            .read_media_chunk(&token, &version, CHUNK_BYTES as u64, 128)
            .unwrap_err();
        assert_eq!(error.code, "conflict");
    }

    #[test]
    fn read_only_media_cannot_escalate_to_writable_hex_but_text_can() {
        let directory = tempfile::tempdir().unwrap();
        let pdf = directory.path().join("document.pdf");
        fs::write(&pdf, b"%PDF-1.7\n").unwrap();
        let mut service = FileService::default();
        service.set_owner("window-a");
        let media = service.open_selected(pdf, None).unwrap();
        let error = service.reopen(&media.metadata.token, "Hex").unwrap_err();
        assert_eq!(error.code, "scope");
        // Reopening the same preview as media remains allowed and read-only.
        assert_eq!(
            service.reopen(&media.metadata.token, "Media").unwrap().kind,
            FileKind::Pdf
        );

        let text = directory.path().join("notes.txt");
        fs::write(&text, "plain text").unwrap();
        let document = service.open_selected(text, None).unwrap();
        let reopened = service.reopen(&document.metadata.token, "Hex").unwrap();
        assert_eq!(reopened.kind, FileKind::Text);
        assert_eq!(reopened.metadata.encoding, "Hex");
    }

    #[test]
    fn validates_content_and_paths() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = FileService::default();
        let path = dir.path().join("fake.png");
        fs::write(&path, b"plain text").unwrap();
        assert!(s.open_selected(path, None).is_err());
        assert!(s.open_selected(dir.path().into(), None).is_err());
        assert!(s.media_metadata("invalid").is_err());
        for (bytes, mime) in [
            (b"GIF89a".as_slice(), "image/gif"),
            (
                b"<svg xmlns=\"http://www.w3.org/2000/svg\">",
                "image/svg+xml",
            ),
            (b"BMxxxx", "image/bmp"),
        ] {
            assert_eq!(signature(bytes).unwrap().1, mime);
        }
    }
    #[test]
    fn icon_cursor_and_avif_are_media_not_hex() {
        let dir = tempfile::tempdir().unwrap();
        let mut service = FileService::default();
        // A 1x1 DIB icon (directory + bitmap header); decoder validation happens in WebView.
        let mut icon = vec![0u8; 62];
        icon[2] = 1;
        icon[4] = 1;
        icon[6] = 1;
        icon[7] = 1;
        icon[14..18].copy_from_slice(&40u32.to_le_bytes());
        icon[18..22].copy_from_slice(&22u32.to_le_bytes());
        icon[22..26].copy_from_slice(&40u32.to_le_bytes());
        icon[26..30].copy_from_slice(&1i32.to_le_bytes());
        icon[30..34].copy_from_slice(&2i32.to_le_bytes());
        for kind in [1, 2] {
            icon[2] = kind;
            let path = dir.path().join(format!("icon-{kind}.txt"));
            fs::write(&path, &icon).unwrap();
            let opened = service.open_selected(path, None).unwrap();
            assert_eq!(opened.kind, FileKind::Image);
            let media = opened.media.unwrap();
            assert_eq!(media.mime, "image/x-icon");
            assert_eq!((media.width, media.height), (Some(1), Some(1)));
        }
        let avif = b"\x00\x00\x00\x18ftypavif\x00\x00\x00\x00mif1avif";
        assert_eq!(signature(avif).unwrap().1, "image/avif");
        assert!(signature(b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic").is_none());
        // A lying directory cannot hide a large embedded PNG from the pixel budget.
        icon[2] = 1;
        icon[22..30].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        icon[34..38].copy_from_slice(b"IHDR");
        icon[38..42].copy_from_slice(&100_000u32.to_be_bytes());
        icon[42..46].copy_from_slice(&100_000u32.to_be_bytes());
        let path = dir.path().join("oversized.ico");
        fs::write(&path, icon).unwrap();
        assert_eq!(
            service
                .open_selected(path, None)
                .unwrap()
                .media
                .unwrap()
                .width,
            Some(100_000)
        );
    }
}

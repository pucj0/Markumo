//! Document-scoped raster import and preview. Never expose general file writes.
use super::{checked_path, fail, FileError, FileService, Result};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::{
    fs,
    io::{Read, Write},
};
#[cfg(test)]
#[path = "images_tests.rs"]
mod tests;

const MAX_IMAGE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageInput {
    pub token: String,
    pub name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageImport {
    pub token: String,
    pub source_token: Option<String>,
    pub bytes: Option<Vec<u8>>,
    pub name: String,
    // None means retain original. Clipboard pixels always need a destination.
    pub directory: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedImage {
    pub path: String,
    pub name: String,
}

fn image_type(bytes: &[u8]) -> Result<&'static str> {
    let kind = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "png"
    } else if bytes.starts_with(&[0xff, 0xd8]) {
        "jpg"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "gif"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "webp"
    } else {
        return fail(
            "image_format",
            "仅支持 PNG、JPEG、GIF、WebP 图片，不支持 SVG。",
        );
    };
    let (w, h) = dimensions(bytes)
        .ok_or_else(|| FileError::new("image_format", "图片头损坏或格式不受支持。"))?;
    if bytes.len() > MAX_IMAGE_BYTES
        || w == 0
        || h == 0
        || w > 16384
        || h > 16384
        || u64::from(w) * u64::from(h) > 16_000_000
    {
        return fail(
            "image_size",
            "图片限制：4 MiB、1600 万像素、单边 16384 像素。",
        );
    }
    Ok(kind)
}

fn guard(root: &Path, path: &Path) -> Result<PathBuf> {
    crate::workspace::guard::validate_under_root(root, path)
        .map_err(|e| FileError::new("image_scope", &e.to_string()))
}

// Keep directories from being renamed/replaced with reparse points during IO on Windows.
fn lock_directory(path: &Path) -> Result<fs::File> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(3).custom_flags(0x02000000 | 0x00200000);
    }
    options.open(path).map_err(FileError::io)
}

fn directory_locks(path: &Path) -> Result<Vec<fs::File>> {
    let mut locks = Vec::new();
    for ancestor in path.ancestors().collect::<Vec<_>>().into_iter().rev() {
        if ancestor.as_os_str().is_empty() {
            continue;
        }
        guard(ancestor, ancestor)?;
        locks.push(lock_directory(ancestor)?);
        guard(ancestor, ancestor)?;
    }
    Ok(locks)
}

fn read_raster(path: &Path) -> Result<Vec<u8>> {
    #[cfg(unix)]
    let mut file = {
        use rustix::fs::{openat, Mode, OFlags};
        let parent = open_unix_directory(path.parent().unwrap(), None)?;
        fs::File::from(
            openat(
                &parent,
                path.file_name().unwrap(),
                OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|e| FileError::io(e.into()))?,
        )
    };
    #[cfg(not(unix))]
    let mut file = {
        let mut options = fs::OpenOptions::new();
        options.read(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(1).custom_flags(0x00200000);
        }
        options.open(path).map_err(FileError::io)?
    };
    let metadata = file.metadata().map_err(FileError::io)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return fail("image_scope", "图片不能是符号链接或重解析点。");
        }
    }
    if !metadata.is_file() || metadata.len() > MAX_IMAGE_BYTES as u64 {
        return fail("image_size", "图片必须为不超过 4 MiB 的普通文件。");
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(MAX_IMAGE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(FileError::io)?;
    if bytes.len() > MAX_IMAGE_BYTES
        || file.metadata().map_err(FileError::io)?.modified().ok() != metadata.modified().ok()
    {
        return fail("image_size", "图片超出预算或读取期间发生变化。");
    }
    Ok(bytes)
}

#[cfg(unix)]
fn open_unix_directory(dir: &Path, create_under: Option<&Path>) -> Result<fs::File> {
    use rustix::fs::{mkdirat, openat, Mode, OFlags};
    let options = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC;
    let mut fd = fs::File::open("/").map_err(FileError::io)?;
    let mut cursor = PathBuf::from("/");
    for component in dir.components() {
        let Component::Normal(part) = component else {
            continue;
        };
        cursor.push(part);
        if create_under.is_some_and(|root| cursor.starts_with(root) && cursor != root) {
            match mkdirat(&fd, part, Mode::from_raw_mode(0o755)) {
                Ok(()) => {}
                Err(e) if e == rustix::io::Errno::EXIST => {}
                Err(e) => return Err(FileError::io(e.into())),
            }
        }
        fd = fs::File::from(
            openat(&fd, part, options, Mode::empty()).map_err(|e| FileError::io(e.into()))?,
        );
    }
    Ok(fd)
}

// Unix traversal and creation are relative to held FDs, never re-follow a path.
#[cfg(unix)]
fn write_unix_image(dir: &Path, root: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf> {
    use rustix::fs::{openat, unlinkat, AtFlags, Mode, OFlags};
    let fd = open_unix_directory(dir, Some(root))?;
    let path = Path::new(name);
    let stem = path.file_stem().unwrap().to_string_lossy();
    let ext = path.extension().unwrap().to_string_lossy();
    for index in 0..10000 {
        let candidate = if index == 0 {
            name.into()
        } else {
            format!("{stem}-{index}.{ext}")
        };
        let opened = openat(
            &fd,
            candidate.as_str(),
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::from_raw_mode(0o644),
        );
        let mut file = match opened {
            Ok(f) => fs::File::from(f),
            Err(e) if e == rustix::io::Errno::EXIST => continue,
            Err(e) => return Err(FileError::io(e.into())),
        };
        if let Err(error) = file
            .write_all(bytes)
            .and_then(|_| file.sync_all())
            .and_then(|_| fd.sync_all())
        {
            let _ = unlinkat(&fd, candidate.as_str(), AtFlags::empty());
            return Err(FileError::io(error));
        }
        // A concurrent directory rename can make the lexical reference stale, but
        // cannot redirect the write through a symlink. Refuse a stale reference.
        if guard(root, &dir.join(&candidate)).is_err() {
            let _ = unlinkat(&fd, candidate.as_str(), AtFlags::empty());
            return fail("image_scope", "写入期间目录发生变化。");
        }
        return Ok(dir.join(candidate));
    }
    fail("image_name", "同名图片过多，请更换名称。")
}

impl FileService {
    fn image_document(&self, token: &str) -> Result<PathBuf> {
        let document = self.validate(token, false)?;
        if !document
            .extension()
            .is_some_and(|s| s.eq_ignore_ascii_case("md") || s.eq_ignore_ascii_case("markdown"))
        {
            return fail("image_scope", "图片导入需要已保存的 Markdown 文件授权。");
        }
        guard(document.parent().unwrap(), &document)?;
        Ok(document)
    }

    pub fn image_inputs(&mut self, paths: Vec<PathBuf>) -> Vec<ImageInput> {
        // Bound retained native-drop capabilities even if no frontend is listening.
        self.image_inputs
            .retain(|_, (owner, _)| owner != &self.current_owner);
        paths
            .into_iter()
            .take(100)
            .map(|path| {
                self.next_token += 1;
                let token = format!("image-input-{}", self.next_token);
                let name = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned();
                self.image_inputs
                    .insert(token.clone(), (self.current_owner.clone(), path));
                ImageInput { token, name }
            })
            .collect()
    }
    pub fn release_image_inputs(&mut self, tokens: &[String]) {
        for token in tokens {
            if self
                .image_inputs
                .get(token)
                .is_some_and(|(o, _)| o == &self.current_owner)
            {
                self.image_inputs.remove(token);
            }
        }
    }
    pub fn open_image_inputs(&mut self, tokens: &[String]) -> super::OpenBatch {
        let paths = tokens
            .iter()
            .filter_map(|t| {
                self.image_inputs
                    .get(t)
                    .filter(|(o, _)| o == &self.current_owner)
                    .map(|(_, p)| p.clone())
            })
            .collect();
        self.release_image_inputs(tokens);
        self.open_batch(paths, None)
    }

    pub fn image_directory(&self, token: &str, relative: &str) -> Result<PathBuf> {
        let document = self.image_document(token)?;
        if relative.is_empty()
            || relative.len() > 1024
            || relative.contains([':', '\0', '\r', '\n'])
            || relative.starts_with(['/', '\\'])
        {
            return fail("image_scope", "图片目录必须是相对于 Markdown 的目录。");
        }
        let stem = document.file_stem().unwrap().to_string_lossy();
        let relative = relative.replace("${filename}", &stem).replace('\\', "/");
        let mut target = document.parent().unwrap().to_path_buf();
        for part in Path::new(&relative).components() {
            match part {
                Component::Normal(name) => {
                    crate::workspace::guard::validate_name(&name.to_string_lossy())
                        .map_err(|e| FileError::new("image_scope", &e))?;
                    target.push(name);
                }
                Component::CurDir => {}
                Component::ParentDir => {
                    if !target.pop() {
                        return fail("image_scope", "图片目录超出文件系统范围。");
                    }
                }
                _ => return fail("image_scope", "图片目录无效。"),
            }
        }
        Ok(target)
    }
    pub fn authorize_image_directory(
        &mut self,
        token: &str,
        relative: &str,
        selected: &Path,
    ) -> Result<()> {
        let target = self.image_directory(token, relative)?;
        let _locks = directory_locks(selected)?;
        if fs::canonicalize(selected).map_err(FileError::io)? != target {
            return fail(
                "image_scope",
                "请选择提示中的图片目标目录，未授予其他目录写权限。",
            );
        }
        self.image_directories
            .insert(token.into(), (self.current_owner.clone(), target));
        Ok(())
    }

    fn resolve_image(&self, token: &str, source: &str) -> Result<PathBuf> {
        let document = self.image_document(token)?;
        if source.is_empty() || source.contains(['\0', '\r', '\n']) || source.len() > 4096 {
            return fail("image_scope", "图片路径无效。");
        }
        let source = source.replace('\\', "/");
        let mut target = document.parent().unwrap().to_path_buf();
        if Path::new(&source).is_absolute() {
            target = PathBuf::from(&source);
        } else {
            for component in Path::new(&source).components() {
                match component {
                    Component::Normal(name) => target.push(name),
                    Component::CurDir => {}
                    Component::ParentDir => {
                        if !target.pop() {
                            return fail("image_scope", "图片路径超出文件系统范围。");
                        }
                    }
                    _ => return fail("image_scope", "图片路径无效。"),
                }
            }
        }
        let canonical = checked_path(&target, false)?;
        guard(canonical.parent().unwrap(), &target)?;
        Ok(canonical)
    }

    pub fn authorize_image_read(
        &mut self,
        token: &str,
        source: &str,
        selected: &Path,
    ) -> Result<()> {
        let expected = self.resolve_image(token, source)?;
        let selected = checked_path(selected, false)?;
        if expected != selected {
            return fail(
                "image_scope",
                "请选择 Markdown 引用的同一图片；未授权其他路径。",
            );
        }
        guard(selected.parent().unwrap(), &selected)?;
        let paths = self.image_reads.entry(token.into()).or_default();
        if paths.len() >= 1024 {
            return fail("image_scope", "本会话图片授权超过上限，请重开文档。");
        }
        if !paths.contains(&selected) {
            paths.push(selected);
        }
        Ok(())
    }

    pub fn import_image(&mut self, input: ImageImport) -> Result<ImportedImage> {
        let document = self.image_document(&input.token)?;
        if input.source_token.is_some() == input.bytes.is_some() {
            return fail("image_input", "请选择一个图片来源。");
        }
        let (bytes, original, name) = if let Some(source) = input.source_token {
            let path = self
                .image_inputs
                .get(&source)
                .filter(|(o, _)| o == &self.current_owner)
                .map(|(_, p)| p.clone())
                .ok_or_else(|| FileError::new("image_scope", "图片来源未获本窗口授权。"))?;
            let canonical = checked_path(&path, false)?;
            let _locks = directory_locks(path.parent().unwrap())?;
            let bytes = read_raster(&path)?;
            if checked_path(&path, false)? != canonical {
                return fail("image_scope", "图片来源在读取期间发生变化。");
            }
            (
                bytes,
                Some(canonical),
                path.file_name().unwrap().to_string_lossy().into_owned(),
            )
        } else {
            (input.bytes.unwrap(), None, input.name)
        };
        let kind = image_type(&bytes)?;
        crate::workspace::guard::validate_name(&name)
            .map_err(|e| FileError::new("image_name", &e))?;
        let extension = Path::new(&name)
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_ascii_lowercase();
        if extension != kind && !(kind == "jpg" && extension == "jpeg") {
            return fail("image_format", "图片扩展名与实际类型不一致。");
        }
        let target = if let Some(relative) = input.directory {
            let dir = self.image_directory(&input.token, &relative)?;
            let parent = document.parent().unwrap();
            let root = if dir.starts_with(parent) {
                parent.to_path_buf()
            } else {
                if !self
                    .image_directories
                    .get(&input.token)
                    .is_some_and(|(o, p)| o == &self.current_owner && p == &dir)
                {
                    return fail(
                        "image_directory_permission",
                        &format!(
                            "目标目录 {} 位于文档目录之外，请明确选择该目录授权。",
                            dir.display()
                        ),
                    );
                }
                dir.clone()
            };
            #[cfg(unix)]
            let saved = write_unix_image(&dir, &root, &name, &bytes)?;
            #[cfg(not(unix))]
            let saved = {
                let mut locks = directory_locks(&root)?;
                let mut cursor = root.clone();
                for component in dir
                    .strip_prefix(&root)
                    .map_err(|_| FileError::new("image_scope", "目录授权不匹配"))?
                    .components()
                {
                    cursor.push(component);
                    guard(&root, &cursor)?;
                    match fs::create_dir(&cursor) {
                        Ok(()) => {}
                        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                        Err(e) => return Err(FileError::io(e)),
                    }
                    guard(&root, &cursor)?;
                    locks.push(lock_directory(&cursor)?);
                    guard(&root, &cursor)?;
                }
                guard(&root, &dir)?;
                let mut temp = tempfile::NamedTempFile::new_in(&dir).map_err(FileError::io)?;
                temp.write_all(&bytes).map_err(FileError::io)?;
                temp.as_file().sync_all().map_err(FileError::io)?;
                let stem = Path::new(&name).file_stem().unwrap().to_string_lossy();
                let mut saved = None;
                for index in 0..10000 {
                    let candidate = dir.join(if index == 0 {
                        name.clone()
                    } else {
                        format!("{stem}-{index}.{extension}")
                    });
                    // Existing files, symlinks and dangling symlinks are collisions, never overwrite.
                    if fs::symlink_metadata(&candidate).is_ok() {
                        continue;
                    }
                    guard(&root, &candidate)?;
                    match temp.persist_noclobber(&candidate) {
                        Ok(_) => {
                            saved = Some(candidate);
                            break;
                        }
                        Err(e) if e.error.kind() == std::io::ErrorKind::AlreadyExists => {
                            temp = e.file;
                        }
                        Err(e) => return Err(FileError::io(e.error)),
                    }
                }
                saved.ok_or_else(|| FileError::new("image_name", "同名图片过多，请更换名称。"))?
            };
            saved
        } else {
            original.ok_or_else(|| {
                FileError::new("image_input", "截图没有原始文件，请选择复制目录。")
            })?
        };
        let reads = self.image_reads.entry(input.token).or_default();
        if !reads.contains(&target) {
            if reads.len() >= 1024 {
                reads.remove(0);
            }
            reads.push(target.clone());
        }
        Ok(ImportedImage {
            path: target.to_string_lossy().into_owned(),
            name: target.file_name().unwrap().to_string_lossy().into_owned(),
        })
    }
}
pub fn dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.get(12..16) == Some(b"IHDR") {
        return Some((
            u32::from_be_bytes(bytes.get(16..20)?.try_into().ok()?),
            u32::from_be_bytes(bytes.get(20..24)?.try_into().ok()?),
        ));
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some((
            u16::from_le_bytes(bytes.get(6..8)?.try_into().ok()?) as u32,
            u16::from_le_bytes(bytes.get(8..10)?.try_into().ok()?) as u32,
        ));
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        let data = bytes.get(20..)?;
        return match bytes.get(12..16)? {
            b"VP8X" => Some((
                1 + u32::from_le_bytes([*data.get(4)?, *data.get(5)?, *data.get(6)?, 0]),
                1 + u32::from_le_bytes([*data.get(7)?, *data.get(8)?, *data.get(9)?, 0]),
            )),
            b"VP8L" if data.first() == Some(&0x2f) => {
                let bits = u32::from_le_bytes(data.get(1..5)?.try_into().ok()?);
                Some((1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)))
            }
            b"VP8 " if data.get(3..6) == Some(&[0x9d, 0x01, 0x2a]) => Some((
                (u16::from_le_bytes(data.get(6..8)?.try_into().ok()?) & 0x3fff) as u32,
                (u16::from_le_bytes(data.get(8..10)?.try_into().ok()?) & 0x3fff) as u32,
            )),
            _ => None,
        };
    }
    if bytes.starts_with(&[0xff, 0xd8]) {
        let mut offset = 2;
        while offset < bytes.len() {
            if *bytes.get(offset)? != 0xff {
                return None;
            }
            while bytes.get(offset) == Some(&0xff) {
                offset += 1;
            }
            let marker = *bytes.get(offset)?;
            offset += 1;
            if marker == 0xda || marker == 0xd9 {
                return None;
            }
            if marker == 1 || (0xd0..=0xd7).contains(&marker) {
                continue;
            }
            let length =
                u16::from_be_bytes(bytes.get(offset..offset + 2)?.try_into().ok()?) as usize;
            if length < 2 || offset.checked_add(length)? > bytes.len() {
                return None;
            }
            if [
                0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
            ]
            .contains(&marker)
                && length >= 7
            {
                return Some((
                    u16::from_be_bytes(bytes.get(offset + 5..offset + 7)?.try_into().ok()?) as u32,
                    u16::from_be_bytes(bytes.get(offset + 3..offset + 5)?.try_into().ok()?) as u32,
                ));
            }
            offset += length;
        }
    }
    None
}

impl FileService {
    pub fn markdown_image(
        &self,
        token: &str,
        relative: &str,
        roots: &[PathBuf],
    ) -> Result<Vec<u8>> {
        let document = self.image_document(token)?;
        let canonical = self.resolve_image(token, relative)?;
        let target = canonical.clone();
        let _locks = directory_locks(canonical.parent().unwrap())?;
        // A chosen document grants its attachment descendants, not arbitrary external reads.
        let authorized = guard(document.parent().unwrap(), &target).is_ok()
            || self
                .image_reads
                .get(token)
                .is_some_and(|paths| paths.contains(&canonical))
            || self
                .image_directories
                .get(token)
                .is_some_and(|(o, dir)| o == &self.current_owner && guard(dir, &target).is_ok())
            || roots
                .iter()
                .any(|root| crate::workspace::guard::validate_under_root(root, &target).is_ok())
            || self
                .grants
                .values()
                .any(|grant| grant.owner == self.current_owner && grant.canonical == canonical);
        if !authorized {
            return fail(
                "image_scope",
                "文档目录外的图片需要单独授权，或将图片目录加入工作区。",
            );
        }
        let metadata = std::fs::metadata(&canonical).map_err(FileError::io)?;
        if metadata.len() > MAX_IMAGE_BYTES as u64 {
            return fail("image_size", "图片超过 4 MiB，已保留可编辑路径。");
        }
        let bytes = read_raster(&canonical)?;
        if checked_path(&target, false)? != canonical {
            return fail("image_scope", "读取期间图片路径发生变化，请重试。");
        }
        if bytes.len() > MAX_IMAGE_BYTES {
            return fail("image_size", "图片超过 4 MiB。");
        }
        let (width, height) = dimensions(&bytes).ok_or_else(|| {
            FileError::new(
                "image_format",
                "仅预览 PNG、JPEG、GIF、WebP；损坏图片或 SVG 保留源码。",
            )
        })?;
        if width == 0
            || height == 0
            || width > 16384
            || height > 16384
            || width as u64 * height as u64 > 16_000_000
        {
            return fail("image_size", "图片尺寸超过安全预览范围。");
        }
        Ok(bytes)
    }
}

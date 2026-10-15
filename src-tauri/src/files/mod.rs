pub(crate) mod atomic;
mod codec;
pub mod classfile;
pub mod images;
#[cfg(test)] mod tests;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs, io::Read, path::{Component, Path, PathBuf}, time::UNIX_EPOCH};

const MAX_BYTES: u64 = 16 * 1024 * 1024;
pub type Result<T> = std::result::Result<T, FileError>;
pub fn decode_search_text(bytes: &[u8]) -> Result<String> { codec::decode(bytes, None).map(|(text, _, _)| text) }
#[derive(Debug, Serialize)]
pub struct FileError { pub code: String, pub message: String }
impl FileError {
    pub fn new(code: &str, message: &str) -> Self { Self { code: code.into(), message: message.into() } }
    pub fn io(error: std::io::Error) -> Self { Self::new("io", &format!("文件操作失败：{error}")) }
}
impl std::fmt::Display for FileError { fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { write!(f, "{}", self.message) } }
impl std::error::Error for FileError {}
pub fn fail<T>(code: &str, message: &str) -> Result<T> { Err(FileError::new(code, message)) }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub token: String, pub path: String, pub name: String, pub encoding: String, pub bom: bool,
    pub eol: String, pub read_only: bool, pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")] pub warning: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFile {
    #[serde(flatten)] pub metadata: FileMetadata,
    pub kind: FileKind,
    // Empty for JavaClass, never decoded from binary bytes.
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")] pub class_info: Option<classfile::ClassInfo>,
}
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileKind { Text, JavaClass }
#[derive(Default, Serialize)]
pub struct OpenBatch { pub files: Vec<OpenFile>, pub errors: Vec<String> }
#[derive(Debug, Serialize)]
pub struct SaveTarget { pub token: String, pub path: String, pub version: Option<String> }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout { pub mode: String, pub sidebar_visible: bool, pub sidebar_width: u16 }
impl Default for Layout { fn default() -> Self { Self { mode: "single".into(), sidebar_visible: false, sidebar_width: 254 } } }
#[derive(Clone, Serialize, Deserialize)]
pub struct Recent { pub path: String, pub name: String }
#[derive(Default, Clone, Serialize, Deserialize)]
pub struct Preferences {
    pub recent: Vec<Recent>, pub layout: Layout,
    #[serde(skip_serializing_if = "Option::is_none")] pub warning: Option<String>,
}
#[derive(Clone)]
struct Grant { selected: PathBuf, canonical: PathBuf, writable: bool, hex: bool, owner: String }
#[derive(Default)]
pub struct FileService {
    grants: HashMap<String, Grant>, next_token: u64,
    pub preferences: Preferences, prefs_path: Option<PathBuf>,
    current_owner: String,
}

pub(crate) fn checked_path(path: &Path, allow_missing: bool) -> Result<PathBuf> {
    if path.to_str().is_none() { return fail("path", "文件路径不是有效 Unicode，暂不支持。" ); }
    if !path.is_absolute() || path.file_name().is_none() { return fail("path", "仅支持用户选择的绝对文件路径。" ); }
    if path.components().any(|part| matches!(part, Component::ParentDir)) { return fail("path", "拒绝包含父目录跳转的路径。" ); }
    #[cfg(windows)]
    if path.components().any(|part| matches!(part, Component::Normal(name) if name.to_string_lossy().contains(':'))) {
        return fail("path", "拒绝 Windows 备用数据流路径。" );
    }
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            if !meta.is_file() || meta.file_type().is_symlink() { return fail("path", "仅支持普通文件；符号链接文件请选择其真实目标。" ); }
            #[cfg(unix)] {
                use std::os::unix::fs::MetadataExt;
                if meta.nlink() > 1 { return fail("path", "暂不支持硬链接文件，请复制为独立文件后打开。" ); }
            }
            fs::canonicalize(path).map_err(FileError::io)
        }
        Err(error) if allow_missing && error.kind() == std::io::ErrorKind::NotFound => {
            let parent = fs::canonicalize(path.parent().unwrap()).map_err(FileError::io)?;
            if !parent.is_dir() { return fail("path", "目标父路径不是目录。" ); }
            Ok(parent.join(path.file_name().unwrap()))
        }
        Err(error) => Err(FileError::io(error)),
    }
}

fn read_disk(path: &Path) -> Result<(Vec<u8>, String, bool)> {
    let file = fs::File::open(path).map_err(FileError::io)?;
    #[cfg(windows)] {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION};
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut info) } == 0 {
            return Err(FileError::io(std::io::Error::last_os_error()));
        }
        if info.nNumberOfLinks > 1 { return fail("path", "暂不支持硬链接文件，请复制为独立文件后打开。" ); }
    }
    let before = file.metadata().map_err(FileError::io)?;
    if !before.is_file() || before.len() > MAX_BYTES { return fail("size", "仅支持不超过 16 MiB 的普通文件；未读取或修改文件。" ); }
    let mut bytes = Vec::new();
    (&file).take(MAX_BYTES + 1).read_to_end(&mut bytes).map_err(FileError::io)?;
    let after = file.metadata().map_err(FileError::io)?;
    if bytes.len() as u64 > MAX_BYTES || bytes.len() as u64 != after.len() || before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return fail("conflict", "读取期间文件发生变化，请重试。" );
    }
    let modified = after.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map(|time| time.as_nanos()).unwrap_or(0);
    let version = format!("{:x}:{}:{modified}", Sha256::digest(&bytes), bytes.len());
    let read_only = after.permissions().readonly() || fs::OpenOptions::new().write(true).open(path).is_err();
    Ok((bytes, version, read_only))
}

pub fn disk_version(path: &Path) -> Result<Option<String>> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(FileError::io(error)),
        Ok(_) => { checked_path(path, false)?; Ok(Some(read_disk(path)?.1)) }
    }
}

impl FileService {
    pub fn set_owner(&mut self, owner: &str) { self.current_owner=owner.to_owned(); }
    pub fn release_owner(&mut self, owner: &str) { self.grants.retain(|_,grant|grant.owner!=owner); }
    pub fn session_path(&self, token: &str) -> Result<PathBuf> {
        let grant=self.grants.get(token).filter(|grant|grant.owner==self.current_owner).ok_or_else(||FileError::new("scope","此窗口没有该文件授权"))?;
        Ok(grant.canonical.clone())
    }
    pub fn configure(&mut self, prefs_path: PathBuf) {
        match fs::File::open(&prefs_path) {
            Ok(file) => {
                let mut bytes = Vec::new();
                if file.take(128 * 1024 + 1).read_to_end(&mut bytes).is_ok() && bytes.len() <= 128 * 1024 {
                    match serde_json::from_slice::<Preferences>(&bytes) {
                        Ok(mut prefs) => { prefs.recent.truncate(20); prefs.layout.sidebar_width = prefs.layout.sidebar_width.clamp(190, 420);
                            if !["single", "workspace"].contains(&prefs.layout.mode.as_str()) { prefs.layout = Layout::default(); }
                            prefs.warning = None; self.preferences = prefs; }
                        Err(_) => self.preferences.warning = Some("最近文件/布局配置损坏，使用默认布局；后续操作将重建配置。".into()),
                    }
                } else { self.preferences.warning = Some("最近文件/布局配置读取失败，使用默认布局。".into()); }
            }
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => self.preferences.warning = Some(format!("配置读取失败：{error}")),
            _ => {},
        }
        self.prefs_path = Some(prefs_path);
    }
    fn persist(&mut self) -> Option<String> {
        let result = (|| -> Result<()> {
            if let Some(path) = &self.prefs_path {
                fs::create_dir_all(path.parent().unwrap()).map_err(FileError::io)?;
                let mut temp = tempfile::NamedTempFile::new_in(path.parent().unwrap()).map_err(FileError::io)?;
                use std::io::Write;
                temp.write_all(&serde_json::to_vec(&self.preferences).map_err(|error| FileError::new("preferences", &error.to_string()))?).map_err(FileError::io)?;
                temp.as_file().sync_all().map_err(FileError::io)?;
                temp.persist(path).map_err(|error| FileError::io(error.error))?;
            }
            Ok(())
        })();
        let warning = result.err().map(|error| format!("文件操作已完成，但最近文件/布局未写入：{error}"));
        self.preferences.warning = warning.clone(); warning
    }
    fn recent(&mut self, path: &Path) -> Option<String> {
        let display = path.to_string_lossy().into_owned();
        self.preferences.recent.retain(|entry| entry.path != display);
        self.preferences.recent.insert(0, Recent { path: display, name: path.file_name().unwrap().to_string_lossy().into_owned() });
        self.preferences.recent.truncate(20); self.persist()
    }
    fn grant(&mut self, selected: PathBuf, canonical: PathBuf, writable: bool) -> String {
        // A new generation avoids late release responses revoking a reopened file.
        // The frontend deduplicates by canonical path and releases extra grants.
        self.next_token += 1; let token = format!("document-{}", self.next_token);
        self.grants.insert(token.clone(), Grant { selected, canonical, writable, hex: false, owner: self.current_owner.clone() }); token
    }
    fn validate(&self, token: &str, missing: bool) -> Result<PathBuf> {
        let grant = self.grants.get(token).ok_or_else(|| FileError::new("scope", "文件授权已经释放或无效。"))?;
        if grant.owner!=self.current_owner { return fail("scope","此窗口没有该文件授权"); }
        if checked_path(&grant.selected, missing)? != grant.canonical { return fail("scope", "文件路径或符号链接目标已变化，拒绝访问。" ); }
        Ok(grant.canonical.clone())
    }
    pub fn open_selected(&mut self, selected: PathBuf, encoding: Option<&str>) -> Result<OpenFile> {
        let path = checked_path(&selected, false)?;
        let (bytes, version, read_only) = read_disk(&path)?;
        // Keep structural inspection as an explicit view; opening is editable by default.
        if encoding == Some("ClassInfo") {
            let class_info = classfile::parse(&bytes)?;
            let token = self.grant(selected, path.clone(), false);
            let warning = self.recent(&path);
            return Ok(OpenFile { metadata: FileMetadata { token, path:path.to_string_lossy().into_owned(), name:path.file_name().unwrap().to_string_lossy().into_owned(),
                encoding:"Binary".into(),bom:false,eol:"LF".into(),read_only:true,version,warning },kind:FileKind::JavaClass,text:String::new(),class_info:Some(class_info) });
        }
        if encoding == Some("Hex") && bytes.len() > MAX_BYTES as usize / 3 { return fail("size", "文件的十六进制显示超过 16 MiB，请使用专用二进制编辑器。"); }
        // Extensions select highlighting only. Binary bytes use an editable,
        // reversible representation instead of a lossy UTF-8 conversion.
        let decoded = codec::decode(&bytes, encoding);
        let (text, encoding, bom) = match decoded {
            Ok(decoded) => decoded,
            Err(error) if encoding.is_none() && byte_fallback_allowed(&bytes, &error) => {
                // Keep the expanded representation within existing editor limits.
                if bytes.len() > MAX_BYTES as usize / 3 { return fail("size", "文件的十六进制显示超过 16 MiB，请使用专用二进制编辑器。"); }
                (codec::hex_text(&bytes), "Hex".into(), false)
            },
            Err(error) => return Err(error),
        };
        guard_text(&text)?;
        let token = self.grant(selected, path.clone(), true);
        self.grants.get_mut(&token).unwrap().hex = encoding == "Hex";
        let warning = self.recent(&path);
        Ok(OpenFile { metadata: FileMetadata { token, path: path.to_string_lossy().into_owned(), name: path.file_name().unwrap().to_string_lossy().into_owned(),
            eol: codec::eol(&text), encoding, bom, read_only, version, warning }, kind:FileKind::Text,text,class_info:None })
    }
    pub fn open_recent(&mut self, path: &str, encoding: Option<&str>) -> Result<OpenFile> {
        if !self.preferences.recent.iter().any(|entry| entry.path == path) { return fail("scope", "该路径不在最近文件授权列表。" ); }
        self.open_selected(PathBuf::from(path), encoding)
    }
    pub fn reopen(&mut self, token: &str, encoding: &str) -> Result<OpenFile> {
        if encoding != "Hex" { self.require_text_grant(token)?; }
        let path = self.validate(token, false)?;
        self.open_selected(path, Some(encoding))
    }
    pub fn prepare_target(&mut self, selected: PathBuf, source: Option<&str>) -> Result<SaveTarget> {
        if let Some(source)=source { self.require_text_grant(source)?; }
        let hex = source.and_then(|token| self.grants.get(token)).is_some_and(|grant| grant.hex);
        let path = checked_path(&selected, true)?;
        if !hex { guard_text_target(&path)?; }
        if let Some((token, _)) = self.grants.iter().find(|(_, grant)| grant.canonical == path) {
            if Some(token.as_str()) != source { return fail("already_open", "目标文件已在其他标签打开，请保存那个标签或选择其他文件名。" ); }
        }
        let version = disk_version(&path)?;
        let token = self.grant(selected, path.clone(), true);
        self.grants.get_mut(&token).unwrap().hex = hex;
        Ok(SaveTarget { token, path: path.to_string_lossy().into_owned(), version })
    }
    pub fn save(&mut self, token: &str, text: &str, expected: Option<&str>, encoding: &str, bom: bool) -> Result<FileMetadata> {
        self.require_text_grant(token)?;
        let path = self.validate(token, true)?;
        if self.grants.get(token).is_some_and(|grant| grant.hex) && encoding != "Hex" {
            return fail("encoding_loss", "字节编辑内容必须按 Hex 保存，不能把十六进制显示文字转换成原文件内容。");
        }
        if encoding != "Hex" { guard_text_target(&path)?; }
        guard_text(text)?;
        let bytes = codec::encode(text, encoding, bom)?;
        if encoding == "Hex" && bytes.len() > MAX_BYTES as usize / 3 { return fail("size", "字节内容超过当前十六进制编辑容量（约 5.33 MiB），已阻止写入。"); }
        if bytes.len() as u64 > MAX_BYTES { return fail("size", "编码后的文件超过 16 MiB，已阻止写入。" ); }
        atomic::write_checked(&path, &bytes, expected)?;
        let (written, version, read_only) = read_disk(&path)?;
        if written != bytes { return fail("conflict", "写入后检测到外部修改；磁盘状态未确认，编辑内容保留。" ); }
        self.grants.get_mut(token).unwrap().hex = encoding == "Hex";
        let warning = self.recent(&path);
        Ok(FileMetadata { token: token.into(), path: path.to_string_lossy().into_owned(), name: path.file_name().unwrap().to_string_lossy().into_owned(),
            encoding: encoding.into(), bom, eol: codec::eol(text), read_only, version, warning })
    }
    pub fn release(&mut self, token: &str) { if self.grants.get(token).is_some_and(|grant|grant.owner==self.current_owner){self.grants.remove(token);} }
    fn require_text_grant(&self, token: &str) -> Result<()> {
        self.session_path(token)?;
        match self.grants.get(token) {
            Some(grant) if !grant.writable => fail("read_only_binary", "ClassFile 仅供只读查看，不能作为文本保存或另存为。"),
            Some(_) => Ok(()),
            None => fail("scope", "文件授权已经释放或无效。"),
        }
    }
    pub fn read_class_hex(&self, token: &str, expected: &str, offset: usize) -> Result<classfile::HexPage> {
        if self.grants.get(token).is_some_and(|grant| grant.writable) { return fail("binary_type", "该文件不是已授权的 ClassFile。"); }
        let path = self.validate(token,false)?;
        let (bytes,version,_) = read_disk(&path)?;
        if version != expected { return fail("conflict", "ClassFile 已被外部修改，请关闭并重新打开后查看。" ); }
        classfile::hex_page(&bytes,offset)
    }
    pub fn revealed_path(&self, token: &str) -> Result<PathBuf> { self.validate(token, false) }
    pub fn update_grant_path(&mut self, old_path: &Path, new_path: &Path) {
        // The old path no longer exists after rename. Compare stored grants instead.
        let old = if old_path.exists() { old_path.canonicalize().unwrap_or_else(|_| old_path.to_path_buf()) }
            else { old_path.parent().and_then(|p| p.canonicalize().ok()).map(|p| p.join(old_path.file_name().unwrap())).unwrap_or_else(|| old_path.to_path_buf()) };
        if let Ok(new) = new_path.canonicalize() {
            for grant in self.grants.values_mut() {
                if let Ok(relative) = grant.canonical.strip_prefix(&old) {
                    let target = if relative.as_os_str().is_empty() { new.clone() } else { new.join(relative) };
                    grant.selected = target.clone();
                    grant.canonical = target;
                }
            }
            for recent in &mut self.preferences.recent {
                if let Ok(relative) = Path::new(&recent.path).strip_prefix(&old) {
                    let target = if relative.as_os_str().is_empty() { new.clone() } else { new.join(relative) };
                    recent.path = target.to_string_lossy().into_owned();
                    recent.name = target.file_name().unwrap_or_default().to_string_lossy().into_owned();
                }
            }
            self.persist();
        }
    }
    pub fn has_grants_under(&self, path: &Path) -> bool {
        self.grants.values().any(|g| g.canonical.starts_with(path))
    }
    pub fn open_batch(&mut self, paths: Vec<PathBuf>, encoding: Option<&str>) -> OpenBatch {
        let mut batch = OpenBatch::default();
        let mut total = 0;
        for (index, path) in paths.into_iter().enumerate() {
            if index >= 20 || total >= 48 * 1024 * 1024 { batch.errors.push("本批已达到 20 个文件或文本体积限制，余下文件请分批选择。".into()); break; }
            match self.open_selected(path.clone(), encoding) {
            Ok(file) => { total += file.class_info.as_ref().map(|info| info.byte_length).unwrap_or(file.text.len()); batch.files.push(file); }, Err(error) => batch.errors.push(format!("{}：{error}", path.display())),
        } }
        batch
    }
    pub fn set_layout(&mut self, layout: Layout) -> Result<()> {
        if !["single", "workspace"].contains(&layout.mode.as_str()) || !(190..=420).contains(&layout.sidebar_width) { return fail("preferences", "布局参数无效。" ); }
        self.preferences.layout = layout;
        if let Some(message) = self.persist() { return fail("preferences", &message); }
        Ok(())
    }
}

fn guard_text(text: &str) -> Result<()> {
    if text.len() as u64 > MAX_BYTES { return fail("size", "解码后的文本超过 16 MiB，本阶段拒绝操作；文件和编辑内容保留。" ); }
    let mut breaks = 0; let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\r' { if chars.peek() == Some(&'\n') { chars.next(); } breaks += 1; }
        else if ch == '\n' { breaks += 1; }
        if breaks > 200_000 { return fail("size", "文件超过 200,001 行，请拆分后打开；大文件优化将在 Phase 7 实施。" ); }
    }
    Ok(())
}
fn guard_text_target(path: &Path) -> Result<()> {
    match fs::File::open(path) {
        Ok(file) => { let mut magic = Vec::with_capacity(4); file.take(4).read_to_end(&mut magic).map_err(FileError::io)?; if magic.as_slice() == classfile::MAGIC { return fail("read_only_binary", "目标是 JVM ClassFile，已阻止文本覆盖。"); } },
        Err(error) if error.kind()==std::io::ErrorKind::NotFound => {},
        Err(error) => return Err(FileError::io(error)),
    }
    Ok(())
}

fn byte_fallback_allowed(bytes: &[u8], error: &FileError) -> bool {
    // A malformed BOM-bearing text file still requires explicit correction.
    (error.code == "binary" || error.code == "encoding") &&
        (bytes.starts_with(classfile::MAGIC) || encoding_rs::Encoding::for_bom(bytes).is_none())
}

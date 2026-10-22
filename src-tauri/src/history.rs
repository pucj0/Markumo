//! Saved-document version history.
//!
//! This is deliberately independent from crash recovery: recovery protects
//! unsaved buffers, this protects text that was previously on disk.
//!
//! Layout under one restricted application directory:
//!
//! ```text
//! <root>/objects/<sha[0..2]>/<sha>.txt   content-addressed bodies
//! <root>/index.json                      per-file metadata only
//! ```
//!
//! Bodies are deduplicated by SHA-256, so saving the same text twice costs one
//! object. The index never contains document text: the list API returns metadata
//! and a body is read only when the user opens a specific version.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

/// Largest single snapshot body. Larger documents keep working but are not
/// versioned, and the caller is told why.
pub const MAX_SNAPSHOT_BYTES: usize = 8 * 1024 * 1024;
/// Versions retained per file.
pub const MAX_ENTRIES_PER_FILE: usize = 40;
/// Total bytes of stored bodies across every file.
pub const MAX_TOTAL_BYTES: usize = 192 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    /// SHA-256 of the body, also the object file name.
    pub hash: String,
    pub bytes: usize,
    /// Milliseconds since the Unix epoch.
    pub created_at: u64,
    /// `disk` is the version that was on disk before a save, `saved` is the text
    /// this editor just wrote, `manual` is an explicit snapshot.
    pub origin: String,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryIndex {
    /// Keyed by the opaque per-file key, never by a path used for I/O.
    files: BTreeMap<String, Vec<HistoryEntry>>,
}

#[derive(Default)]
pub struct HistoryStore {
    dir: Option<PathBuf>,
    lock: Mutex<()>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRecordResult {
    pub entry: HistoryEntry,
    pub duplicated: bool,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryUsage {
    pub files: usize,
    pub entries: usize,
    pub bytes: u64,
    pub max_bytes: u64,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Files are identified by an opaque digest of their path. It is never used for
/// I/O, so a hostile path cannot address anything on its own.
pub fn file_key(path: &str) -> String {
    legacy_key(&normalized_path(path))
}

fn normalized_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    if normalized.get(..8).is_some_and(|prefix| prefix.eq_ignore_ascii_case("//?/UNC/")) {
        format!("//{}", &normalized[8..])
    } else { normalized.strip_prefix("//?/").unwrap_or(&normalized).to_owned() }
}

fn legacy_key(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let lowered = if cfg!(windows) { normalized.to_lowercase() } else { normalized };
    sha256(lowered.as_bytes())
}

fn valid_key(key: &str) -> bool {
    key.len() == 64 && key.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn valid_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn restrict(path: &Path, directory: bool) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = if directory { 0o700 } else { 0o600 };
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(mode));
    }
    #[cfg(not(unix))]
    let _ = (path, directory);
}

/// Writes `bytes` next to `target` and renames it into place, so a crash or a
/// full disk leaves the previous file untouched.
fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = target.parent().ok_or("目标路径缺少父目录")?;
    fs::create_dir_all(parent).map_err(|e| format!("创建历史目录失败：{e}"))?;
    restrict(parent, true);
    let temp = parent.join(format!(
        ".tmp-{}-{}",
        std::process::id(),
        now_millis()
    ));
    let result = (|| {
        let mut file = fs::File::create(&temp).map_err(|e| format!("写入历史文件失败：{e}"))?;
        restrict(&temp, false);
        file.write_all(bytes).map_err(|e| format!("写入历史文件失败：{e}"))?;
        file.sync_all().map_err(|e| format!("同步历史文件失败：{e}"))?;
        drop(file);
        fs::rename(&temp, target).map_err(|e| format!("提交历史文件失败：{e}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

impl HistoryStore {
    pub fn configure(&mut self, dir: PathBuf) {
        self.dir = Some(dir);
    }

    fn root(&self) -> Result<PathBuf, String> {
        let dir = self.dir.as_ref().ok_or("历史版本存储尚未初始化")?;
        fs::create_dir_all(dir).map_err(|e| format!("创建历史目录失败：{e}"))?;
        restrict(dir, true);
        Ok(dir.clone())
    }

    fn index_path(&self) -> Result<PathBuf, String> {
        Ok(self.root()?.join("index.json"))
    }

    fn object_path(&self, hash: &str) -> Result<PathBuf, String> {
        if !valid_hash(hash) {
            return Err("历史内容哈希无效".into());
        }
        Ok(self.root()?.join("objects").join(&hash[..2]).join(format!("{hash}.txt")))
    }

    fn read_index(&self) -> Result<HistoryIndex, String> {
        let path = self.index_path()?;
        match fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice::<HistoryIndex>(&bytes) {
                Ok(index) => Ok(index),
                // A corrupt index must not take the whole feature down: keep the
                // file aside for diagnosis and start a new one.
                Err(error) => {
                    let backup = path.with_extension(format!("corrupt-{}", now_millis()));
                    let _ = fs::rename(&path, &backup);
                    Err(format!("历史索引损坏，已另存为 {}：{error}", backup.display()))
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HistoryIndex::default()),
            Err(error) => Err(format!("读取历史索引失败：{error}")),
        }
    }

    fn write_index(&self, index: &HistoryIndex) -> Result<(), String> {
        let bytes = serde_json::to_vec(index).map_err(|e| e.to_string())?;
        write_atomic(&self.index_path()?, &bytes)
    }

    fn index_for(&self, path: &str) -> Result<HistoryIndex, String> {
        let mut index = self.read_index()?;
        let display = normalized_path(path);
        let key = file_key(path);
        let mut aliases = vec![legacy_key(path)];
        if display.starts_with("//") { aliases.push(legacy_key(&format!("//?/UNC/{}", display.trim_start_matches('/')))); }
        else if display.as_bytes().get(1) == Some(&b':') { aliases.push(legacy_key(&format!("//?/{display}"))); }
        for alias in aliases {
            if alias == key { continue }
            if let Some(previous) = index.files.remove(&alias) {
                let entries = index.files.entry(key.clone()).or_default();
                entries.extend(previous);
                entries.sort_by_key(|entry| std::cmp::Reverse(entry.created_at));
                let mut seen = HashSet::new();
                entries.retain(|entry| seen.insert(entry.hash.clone()));
            }
        }
        Ok(index)
    }

    /// Stores one body and registers it for `path`. Identical content is
    /// deduplicated and reported instead of stored twice.
    pub fn record(
        &self,
        path: &str,
        text: &str,
        origin: &str,
        label: Option<String>,
    ) -> Result<HistoryRecordResult, String> {
        self.record_inner(path, text, origin, label, true)
    }

    /// Imports must never evict an earlier imported body: the legacy source is
    /// the retry journal until every record has been durably accepted.
    pub fn import_legacy(&self, path: &str, text: &str, label: Option<String>) -> Result<HistoryRecordResult, String> {
        self.record_inner(path, text, "manual", label, false)
    }

    fn record_inner(&self, path: &str, text: &str, origin: &str, label: Option<String>, allow_eviction: bool) -> Result<HistoryRecordResult, String> {
        let key = file_key(path);
        if !valid_key(&key) {
            return Err("文件标识无效".into());
        }
        let origin = match origin {
            "disk" | "saved" | "manual" => origin,
            _ => "manual",
        };
        if text.len() > MAX_SNAPSHOT_BYTES {
            return Err(format!(
                "文档超过 {} MiB，未记录历史版本",
                MAX_SNAPSHOT_BYTES / (1024 * 1024)
            ));
        }
        let _guard = self.lock.lock().map_err(|_| "历史存储状态损坏")?;
        let mut index = self.index_for(path)?;
        let hash = sha256(text.as_bytes());
        let bytes = text.len();

        let entries = index.files.entry(key.clone()).or_default();
        if let Some(existing) = entries.iter().find(|entry| entry.hash == hash) {
            return Ok(HistoryRecordResult {
                entry: existing.clone(),
                duplicated: true,
                warnings: Vec::new(),
            });
        }

        if !allow_eviction {
            if entries.len() >= MAX_ENTRIES_PER_FILE {
                return Err("迁移超出单文件历史配额，旧来源已保留，请清理历史后重试".into());
            }
            let references = referenced_hashes(&index);
            let additional = if references.contains(&hash) { 0 } else { bytes as u64 };
            if self.usage_of(&references)? + additional > MAX_TOTAL_BYTES as u64 {
                return Err("迁移超出历史总配额，旧来源已保留，请清理历史后重试".into());
            }
        }
        let entries = index.files.get_mut(&key).unwrap();
        let object = self.object_path(&hash)?;
        if !object.is_file() {
            write_atomic(&object, text.as_bytes())?;
        }

        let entry = HistoryEntry {
            id: format!("{}-{}-{}", origin, now_millis(), &hash[..16]),
            hash: hash.clone(),
            bytes,
            created_at: now_millis(),
            origin: origin.into(),
            label,
        };
        entries.insert(0, entry.clone());

        let mut warnings = Vec::new();
        // Keep the newest `MAX_ENTRIES_PER_FILE` versions per file.
        while entries.len() > MAX_ENTRIES_PER_FILE {
            entries.pop();
        }
        warnings.extend(self.trim_total(&mut index));
        self.write_index(&index)?;
        self.collect_garbage(&index)?;
        Ok(HistoryRecordResult {
            entry,
            duplicated: false,
            warnings,
        })
    }

    /// Drops the oldest entries until the total stored size fits the budget.
    fn trim_total(&self, index: &mut HistoryIndex) -> Vec<String> {
        let mut warnings = Vec::new();
        loop {
            let references = referenced_hashes(index);
            let usage = self.usage_of(&references).unwrap_or(0);
            if usage <= MAX_TOTAL_BYTES as u64 {
                break;
            }
            // Evict the globally oldest entry, which is the tail of the longest
            // history after sorting by timestamp.
            let mut oldest: Option<(String, usize, u64)> = None;
            for (key, entries) in index.files.iter() {
                for (position, entry) in entries.iter().enumerate() {
                    if oldest
                        .as_ref()
                        .map(|(_, _, created)| entry.created_at < *created)
                        .unwrap_or(true)
                    {
                        oldest = Some((key.clone(), position, entry.created_at));
                    }
                }
            }
            let Some((key, position, _)) = oldest else { break };
            if let Some(entries) = index.files.get_mut(&key) {
                if position < entries.len() {
                    entries.remove(position);
                }
                if entries.is_empty() {
                    index.files.remove(&key);
                }
            }
            warnings.push("历史版本总量超过上限，已清理最旧的版本".to_string());
        }
        warnings
    }

    fn collect_garbage(&self, index: &HistoryIndex) -> Result<(), String> {
        let references = referenced_hashes(index);
        let root = self.root()?.join("objects");
        let Ok(directories) = fs::read_dir(&root) else {
            return Ok(());
        };
        for directory in directories.flatten() {
            if !directory.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                continue;
            }
            let Ok(files) = fs::read_dir(directory.path()) else { continue };
            for file in files.flatten() {
                let Some(stem) = file.path().file_stem().and_then(|stem| stem.to_str()).map(str::to_owned) else {
                    continue;
                };
                if !references.contains(&stem) {
                    let _ = fs::remove_file(file.path());
                }
            }
        }
        Ok(())
    }

    fn usage_of(&self, references: &HashSet<String>) -> Result<u64, String> {
        let mut total = 0u64;
        for hash in references {
            if let Ok(path) = self.object_path(hash) {
                if let Ok(metadata) = fs::metadata(path) {
                    total += metadata.len();
                }
            }
        }
        Ok(total)
    }

    pub fn list(&self, path: &str) -> Result<Vec<HistoryEntry>, String> {
        let key = file_key(path);
        let _guard = self.lock.lock().map_err(|_| "历史存储状态损坏")?;
        Ok(self.index_for(path)?.files.get(&key).cloned().unwrap_or_default())
    }

    pub fn read(&self, path: &str, id: &str) -> Result<String, String> {
        if !valid_id(id) {
            return Err("历史版本标识无效".into());
        }
        let key = file_key(path);
        let _guard = self.lock.lock().map_err(|_| "历史存储状态损坏")?;
        let index = self.index_for(path)?;
        let entry = index
            .files
            .get(&key)
            .and_then(|entries| entries.iter().find(|entry| entry.id == id))
            .ok_or("历史版本不存在")?
            .clone();
        let bytes = fs::read(self.object_path(&entry.hash)?)
            .map_err(|e| format!("读取历史版本失败：{e}"))?;
        String::from_utf8(bytes).map_err(|e| format!("历史版本不是有效 UTF-8：{e}"))
    }

    pub fn delete(&self, path: &str, id: &str) -> Result<bool, String> {
        if !valid_id(id) {
            return Err("历史版本标识无效".into());
        }
        let key = file_key(path);
        let _guard = self.lock.lock().map_err(|_| "历史存储状态损坏")?;
        let mut index = self.index_for(path)?;
        let Some(entries) = index.files.get_mut(&key) else { return Ok(false) };
        let before = entries.len();
        entries.retain(|entry| entry.id != id);
        let removed = entries.len() != before;
        if entries.is_empty() {
            index.files.remove(&key);
        }
        if removed {
            self.write_index(&index)?;
            self.collect_garbage(&index)?;
        }
        Ok(removed)
    }

    pub fn clear(&self, path: &str) -> Result<(), String> {
        let key = file_key(path);
        let _guard = self.lock.lock().map_err(|_| "历史存储状态损坏")?;
        let mut index = self.index_for(path)?;
        index.files.remove(&key);
        self.write_index(&index)?;
        self.collect_garbage(&index)
    }

    pub fn usage(&self) -> Result<HistoryUsage, String> {
        let _guard = self.lock.lock().map_err(|_| "历史存储状态损坏")?;
        let index = self.read_index()?;
        let references = referenced_hashes(&index);
        let entries = index.files.values().map(Vec::len).sum();
        Ok(HistoryUsage {
            files: index.files.len(),
            entries,
            bytes: self.usage_of(&references)?,
            max_bytes: MAX_TOTAL_BYTES as u64,
        })
    }
}

fn referenced_hashes(index: &HistoryIndex) -> HashSet<String> {
    index
        .files
        .values()
        .flatten()
        .map(|entry| entry.hash.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (HistoryStore, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let mut store = HistoryStore::default();
        store.configure(dir.path().join("history"));
        (store, dir)
    }

    #[test]
    fn record_list_and_read_round_trip() {
        let (store, _dir) = store();
        let result = store.record("/docs/a.md", "# one\n", "saved", None).unwrap();
        assert!(!result.duplicated);
        let entries = store.list("/docs/a.md").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(store.read("/docs/a.md", &entries[0].id).unwrap(), "# one\n");
        assert_eq!(result.entry.bytes, 6);
    }

    #[test]
    fn identical_content_is_deduplicated() {
        let (store, _dir) = store();
        store.record("/docs/a.md", "same", "saved", None).unwrap();
        let second = store.record("/docs/a.md", "same", "saved", None).unwrap();
        assert!(second.duplicated);
        assert_eq!(store.list("/docs/a.md").unwrap().len(), 1);
    }

    #[test]
    fn legacy_import_is_retryable_without_eviction_or_duplicate_ids() {
        let (store, _dir) = store();
        for index in 0..MAX_ENTRIES_PER_FILE {
            store.import_legacy("/legacy.md", &format!("legacy {index}"), None).unwrap();
        }
        let before = store.list("/legacy.md").unwrap();
        assert!(store.import_legacy("/legacy.md", "over quota", None).unwrap_err().contains("配额"));
        assert_eq!(store.list("/legacy.md").unwrap().iter().map(|entry| &entry.id).collect::<Vec<_>>(), before.iter().map(|entry| &entry.id).collect::<Vec<_>>());
        let retry = store.import_legacy("/legacy.md", "legacy 0", None).unwrap();
        assert!(retry.duplicated);
        assert_eq!(retry.entry.id, before.last().unwrap().id);
        assert_eq!(store.list("/legacy.md").unwrap().len(), MAX_ENTRIES_PER_FILE);
    }

    #[test]
    fn the_same_body_is_shared_between_files() {
        let (store, _dir) = store();
        store.record("/docs/a.md", "shared", "saved", None).unwrap();
        store.record("/docs/b.md", "shared", "saved", None).unwrap();
        let objects: Vec<_> = fs::read_dir(store.root().unwrap().join("objects"))
            .unwrap()
            .flatten()
            .flat_map(|dir| fs::read_dir(dir.path()).unwrap().flatten())
            .collect();
        assert_eq!(objects.len(), 1, "one object for identical bodies");
        assert_eq!(store.list("/docs/b.md").unwrap().len(), 1);
    }

    #[test]
    fn a_file_keeps_at_most_the_configured_number_of_versions() {
        let (store, _dir) = store();
        for index in 0..(MAX_ENTRIES_PER_FILE + 5) {
            store.record("/docs/a.md", &format!("body {index}"), "saved", None).unwrap();
        }
        assert_eq!(store.list("/docs/a.md").unwrap().len(), MAX_ENTRIES_PER_FILE);
    }

    #[test]
    fn oversized_documents_are_refused_with_a_reason() {
        let (store, _dir) = store();
        let text = "x".repeat(MAX_SNAPSHOT_BYTES + 1);
        let error = store.record("/docs/a.md", &text, "saved", None).unwrap_err();
        assert!(error.contains("MiB"));
        assert!(store.list("/docs/a.md").unwrap().is_empty());
    }

    #[test]
    fn delete_and_clear_remove_objects_that_are_no_longer_referenced() {
        let (store, _dir) = store();
        let first = store.record("/docs/a.md", "one", "saved", None).unwrap();
        store.record("/docs/a.md", "two", "saved", None).unwrap();
        assert!(store.delete("/docs/a.md", &first.entry.id).unwrap());
        let object = store.object_path(&first.entry.hash).unwrap();
        assert!(!object.exists(), "unreferenced object is collected");
        store.clear("/docs/a.md").unwrap();
        assert!(store.list("/docs/a.md").unwrap().is_empty());
    }

    #[test]
    fn a_dangling_entry_reports_an_error_instead_of_empty_text() {
        let (store, _dir) = store();
        let result = store.record("/docs/a.md", "body", "saved", None).unwrap();
        fs::remove_file(store.object_path(&result.entry.hash).unwrap()).unwrap();
        assert!(store.read("/docs/a.md", &result.entry.id).is_err());
    }

    #[test]
    fn a_corrupt_index_is_set_aside_and_the_store_keeps_working() {
        let (store, _dir) = store();
        fs::create_dir_all(store.root().unwrap()).unwrap();
        fs::write(store.index_path().unwrap(), b"{not json").unwrap();
        assert!(store.list("/docs/a.md").is_err());
        // The broken file was moved away, so the next write starts clean.
        store.record("/docs/a.md", "fresh", "saved", None).unwrap();
        assert_eq!(store.list("/docs/a.md").unwrap().len(), 1);
    }

    #[test]
    fn invalid_keys_hashes_and_ids_are_rejected() {
        let (store, _dir) = store();
        assert!(store.read("/docs/a.md", "../escape").is_err());
        assert!(store.object_path("nope").is_err());
        assert_eq!(file_key("/docs/A.md").len(), 64);
    }

    #[test]
    fn crlf_and_unicode_bodies_are_stored_byte_exactly() {
        let (store, _dir) = store();
        let text = "第一行\r\n第二行 🙂\r\n";
        store.record("/docs/中文.md", text, "manual", Some("手工".into())).unwrap();
        let entries = store.list("/docs/中文.md").unwrap();
        assert_eq!(store.read("/docs/中文.md", &entries[0].id).unwrap(), text);
        assert_eq!(entries[0].label.as_deref(), Some("手工"));
    }

    #[test]
    fn usage_reports_total_bytes_and_entry_counts() {
        let (store, _dir) = store();
        store.record("/docs/a.md", "12345", "saved", None).unwrap();
        store.record("/docs/b.md", "1234567", "saved", None).unwrap();
        let usage = store.usage().unwrap();
        assert_eq!(usage.files, 2);
        assert_eq!(usage.entries, 2);
        assert_eq!(usage.bytes, 12);
    }

    #[test]
    fn windows_and_posix_spellings_map_to_the_same_file_key() {
        assert_eq!(file_key(r"\\?\C:\docs\a.md"), file_key("C:/docs/a.md"));
        assert_eq!(file_key(r"\\?\UNC\server\docs\a.md"), file_key("//server/docs/a.md"));
        assert_eq!(file_key("C:\\docs\\a.md"), file_key("C:/docs/a.md"));
        #[cfg(windows)]
        assert_eq!(file_key("C:/docs/A.MD"), file_key("c:/docs/a.md"));
    }

    #[test]
    fn old_namespaced_history_keys_are_read_and_merged_without_losing_bodies() {
        let (store, _dir) = store();
        let path = "C:/docs/a.md";
        let entry = store.record(path, "legacy body", "manual", None).unwrap().entry;
        let mut index = store.read_index().unwrap();
        let rows = index.files.remove(&file_key(path)).unwrap();
        index.files.insert(legacy_key(r"\\?\C:\docs\a.md"), rows);
        store.write_index(&index).unwrap();
        assert_eq!(store.list(path).unwrap().len(), 1);
        assert_eq!(store.read(path, &entry.id).unwrap(), "legacy body");
        store.record(path, "new body", "saved", None).unwrap();
        assert_eq!(store.list(path).unwrap().len(), 2);
        assert_eq!(store.read_index().unwrap().files.len(), 1);
    }
}

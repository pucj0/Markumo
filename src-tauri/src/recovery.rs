//! Bounded, atomic recovery snapshots for unsaved text documents.
//!
//! Snapshots live only under the application data directory. Each file is a
//! self-contained JSON record with its own checksum, so a crash can leave at
//! worst an unreadable temporary file; a half-written record is never accepted
//! as valid. User paths are metadata only and are never used as storage names.
use crate::files::atomic;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

pub const MAX_RECORDS: usize = 64;
pub const MAX_TEXT: usize = 8 * 1024 * 1024;
pub const MAX_TOTAL: u64 = 64 * 1024 * 1024;
const MAX_FILE: usize = MAX_TEXT + 1024 * 1024;
const MAX_NAME: usize = 512;
const MAX_PATH: usize = 16384;
const MAX_PANES: usize = 8;
const SCHEMA_VERSION: u8 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryPane {
    pub pane: String,
    #[serde(default)]
    pub mode: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(deserialize_with = "bounded_text")]
    pub text: String,
    pub encoding: String,
    pub bom: bool,
    pub eol: String,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub panes: Vec<RecoveryPane>,
    #[serde(default)]
    pub disk_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryRecord {
    pub schema_version: u8,
    pub id: String,
    pub name: String,
    pub path: Option<String>,
    pub text: String,
    pub encoding: String,
    pub bom: bool,
    pub eol: String,
    pub mode: Option<String>,
    #[serde(default)]
    pub panes: Vec<RecoveryPane>,
    pub disk_version: Option<String>,
    pub disk_size: Option<u64>,
    pub disk_modified_ns: Option<u64>,
    pub char_count: usize,
    pub updated_at: u64,
    pub checksum: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySummary {
    pub id: String,
    pub name: String,
    pub path: Option<String>,
    pub updated_at: u64,
    pub char_count: usize,
    pub size_bytes: u64,
    pub mode: Option<String>,
    pub panes: Vec<RecoveryPane>,
    pub disk_exists: bool,
    pub disk_changed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryList {
    pub records: Vec<RecoverySummary>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySaveResult {
    pub record: RecoverySummary,
    pub warnings: Vec<String>,
}

#[derive(Default)]
pub struct RecoveryService {
    dir: Option<PathBuf>,
    limits: Limits,
}

#[derive(Clone, Copy)]
struct Limits {
    records: usize,
    total: u64,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            records: MAX_RECORDS,
            total: MAX_TOTAL,
        }
    }
}
pub type RecoveryStore = Mutex<RecoveryService>;

enum LoadError {
    Io(String),
    Corrupt(String),
}

impl RecoveryService {
    pub fn configure(&mut self, dir: PathBuf) {
        self.dir = Some(dir);
    }

    fn directory(&self) -> Result<PathBuf, String> {
        let dir = self.dir.as_ref().ok_or("恢复存储尚未初始化")?;
        fs::create_dir_all(dir).map_err(|e| format!("创建恢复目录失败: {e}"))?;
        restrict(dir, true);
        Ok(dir.clone())
    }

    /// Stable sidecar locks serialize save/delete/prune/quarantine, including
    /// separate services/processes using the same profile. Never remove this
    /// file while the profile is live; the OS releases its lock on a crash.
    fn transaction(&self) -> Result<fs::File, String> {
        let path = self.directory()?.join(".recovery.lock");
        if fs::symlink_metadata(&path).is_ok_and(|m| !m.is_file() || m.file_type().is_symlink()) {
            return Err("恢复存储锁不是普通文件".into());
        }
        let lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&path)
            .map_err(|e| format!("打开恢复存储锁失败：{e}"))?;
        restrict(&path, false);
        lock.lock().map_err(|e| format!("锁定恢复存储失败：{e}"))?;
        Ok(lock)
    }

    pub fn list(&self) -> Result<RecoveryList, String> {
        let _transaction = self.transaction()?;
        let dir = self.directory()?;
        let mut warnings = self.prune_files()?;
        let mut entries = Vec::new();
        for entry in fs::read_dir(&dir).map_err(|e| format!("读取恢复目录失败: {e}"))? {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) else {
                continue;
            };
            if validate_id(stem).is_err() {
                continue;
            }
            match read_record(&path, stem, self.limits.records) {
                Ok(record) => {
                    let size = entry.metadata().map_err(|e| e.to_string())?.len();
                    entries.push((record, path, size));
                }
                Err(LoadError::Corrupt(reason)) => {
                    let quarantined = quarantine(&path, stem);
                    warnings.push(if quarantined {
                        format!("恢复快照 {stem} 损坏，已隔离：{reason}")
                    } else {
                        format!("恢复快照 {stem} 损坏，无法隔离：{reason}")
                    });
                }
                Err(LoadError::Io(reason)) => {
                    warnings.push(format!("恢复快照 {stem} 暂时无法读取：{reason}"));
                }
            }
        }
        entries.sort_by_key(|(record, _, _)| std::cmp::Reverse(record.updated_at));
        let records = entries
            .iter()
            .map(|(record, _, size)| summary(record, *size))
            .collect();
        Ok(RecoveryList { records, warnings })
    }

    pub fn read(&self, id: &str) -> Result<RecoveryRecord, String> {
        validate_id(id)?;
        let _transaction = self.transaction()?;
        let path = self.directory()?.join(format!("{id}.json"));
        match read_record(&path, id, self.limits.records) {
            Ok(record) => Ok(record),
            Err(LoadError::Io(reason)) => Err(format!("读取恢复快照失败：{reason}")),
            Err(LoadError::Corrupt(reason)) => {
                let _ = quarantine(&path, id);
                Err(format!("恢复快照无效，已隔离：{reason}"))
            }
        }
    }

    pub fn save(&self, input: RecoveryInput) -> Result<RecoverySaveResult, String> {
        let _transaction = self.transaction()?;
        let updating = input.id.is_some();
        let name = valid_name(&input.name)?;
        let path = input.path.as_deref().map(valid_path).transpose()?;
        let encoding = valid_encoding(&input.encoding)?;
        let eol = valid_eol(&input.eol)?;
        let mode = input.mode.as_deref().map(valid_mode).transpose()?;
        let panes = valid_panes(input.panes)?;
        if input.text.len() > MAX_TEXT {
            return Err(format!(
                "单个恢复快照超过 {} MiB；当前内容未获得崩溃恢复保护",
                MAX_TEXT / (1024 * 1024)
            ));
        }
        let id = match input.id.as_deref() {
            Some(id) => {
                validate_id(id)?;
                id.to_owned()
            }
            None => random_id()?,
        };
        let (disk_size, disk_modified_ns) = path
            .as_deref()
            .and_then(disk_stat)
            .map_or((None, None), |(size, modified)| {
                (Some(size), Some(modified))
            });
        let updated_at = now_ms();
        let checksum = checksum(&input.text);
        let record = RecoveryRecord {
            schema_version: SCHEMA_VERSION,
            id: id.clone(),
            name,
            path,
            text: input.text,
            encoding,
            bom: input.bom,
            eol,
            mode,
            panes,
            disk_version: input.disk_version.filter(|value| value.len() <= 256),
            disk_size,
            disk_modified_ns,
            char_count: 0,
            updated_at,
            checksum,
        };
        let record = with_derived(&record)?;
        let bytes = serde_json::to_vec(&record).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_FILE {
            return Err("恢复快照编码后超过大小上限，未写入".into());
        }
        let dir = self.directory()?;
        let target = dir.join(format!("{id}.json"));
        let expected = if updating {
            let version = crate::files::disk_version(&target)
                .map_err(|e| e.message)?
                .ok_or("恢复快照已删除，不能用过期更新重新创建")?;
            // Only a validated, unchanged snapshot may be replaced. A corrupt or
            // raced target is preserved for inspection rather than overwritten.
            read_record(&target, &id, self.limits.records).map_err(|e| match e {
                LoadError::Io(reason) | LoadError::Corrupt(reason) => {
                    format!("更新前验证恢复快照失败：{reason}")
                }
            })?;
            if crate::files::disk_version(&target)
                .map_err(|e| e.message)?
                .as_ref()
                != Some(&version)
            {
                return Err("更新前恢复快照版本发生变化，已保留磁盘内容".into());
            }
            Some(version)
        } else {
            None
        };
        // Reserve budget before the commit; never prune the snapshot being
        // updated or turn a committed write into a reported prune failure.
        let warnings = self.prune_for_save(Some((&target, bytes.len() as u64)))?;
        #[cfg(test)]
        before_snapshot_write(&target);
        // Reuse the shared writer's pre-commit synchronization variant. It has
        // the same conditional-create/replace guards, but cannot report a Unix
        // directory-fsync error after replacing our last valid snapshot.
        atomic::write_conversion_checked(&target, &bytes, expected.as_deref(), || Ok(()))
            .map_err(|e| e.message)?;
        restrict(&target, false);
        Ok(RecoverySaveResult {
            record: summary(&record, bytes.len() as u64),
            warnings,
        })
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        validate_id(id)?;
        let _transaction = self.transaction()?;
        let path = self.directory()?.join(format!("{id}.json"));
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("删除恢复快照失败: {error}")),
        }
    }

    /// Enforce count/space limits from metadata only. Startup must not parse
    /// every body merely to decide which old snapshot to remove.
    fn prune_files(&self) -> Result<Vec<String>, String> {
        self.prune_for_save(None)
    }

    fn prune_for_save(&self, incoming: Option<(&Path, u64)>) -> Result<Vec<String>, String> {
        if incoming.is_some_and(|(_, size)| size > self.limits.total || self.limits.records == 0) {
            return Err("恢复快照超过存储预算，最后一份有效快照未修改".into());
        }
        let dir = self.directory()?;
        let mut entries = Vec::new();
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
                continue;
            }
            let path = entry.path();
            if incoming.is_some_and(|(target, _)| target == path) {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) else {
                continue;
            };
            if path.extension().and_then(|ext| ext.to_str()) != Some("json")
                || validate_id(stem).is_err()
            {
                continue;
            }
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            entries.push((
                stem.to_owned(),
                path,
                metadata.len(),
                file_mtime_ns(&metadata),
            ));
        }
        entries.sort_by_key(|(_, _, _, modified)| *modified);
        let mut total: u64 = entries.iter().map(|(_, _, size, _)| *size).sum::<u64>()
            + incoming.map_or(0, |(_, size)| size);
        let mut warnings = Vec::new();
        while entries.len() + usize::from(incoming.is_some()) > self.limits.records
            || total > self.limits.total
        {
            let Some((id, path, size, _)) = entries.first().cloned() else {
                break;
            };
            match fs::remove_file(&path) {
                Ok(()) => {
                    total = total.saturating_sub(size);
                    entries.remove(0);
                    warnings.push(format!("恢复快照数量或空间超限，已清理最旧记录 {id}"));
                }
                Err(error) => {
                    return Err(format!(
                        "恢复快照超过数量/空间上限，且清理最旧记录失败: {error}"
                    ))
                }
            }
        }
        Ok(warnings)
    }
}

fn with_derived(record: &RecoveryRecord) -> Result<RecoveryRecord, String> {
    let mut record = record.clone();
    record.char_count = record.text.chars().count();
    record.checksum = checksum(&record.text);
    Ok(record)
}

fn summary(record: &RecoveryRecord, size_bytes: u64) -> RecoverySummary {
    let (disk_exists, disk_changed) = match record.path.as_deref() {
        Some(path) => disk_state(path, record.disk_size, record.disk_modified_ns),
        None => (false, false),
    };
    RecoverySummary {
        id: record.id.clone(),
        name: record.name.clone(),
        path: record.path.clone(),
        updated_at: record.updated_at,
        char_count: record.char_count,
        size_bytes,
        mode: record.mode.clone(),
        panes: record.panes.clone(),
        disk_exists,
        disk_changed,
    }
}

fn disk_state(path: &str, size: Option<u64>, modified: Option<u64>) -> (bool, bool) {
    if remote_path(path) {
        return (false, true);
    }
    match fs::metadata(Path::new(path)) {
        Ok(metadata) if metadata.is_file() => (
            true,
            Some(metadata.len()) != size || modified_ns(&metadata) != modified,
        ),
        Ok(_) => (false, true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (false, true),
        Err(_) => (false, true),
    }
}

fn disk_stat(path: &str) -> Option<(u64, u64)> {
    if remote_path(path) {
        return None;
    }
    let metadata = fs::metadata(Path::new(path)).ok()?;
    if !metadata.is_file() {
        return None;
    }
    Some((metadata.len(), modified_ns(&metadata)?))
}

/// Never make a network/device metadata request from a startup list. A
/// tampered recovery record must not be able to trigger UNC authentication.
fn remote_path(path: &str) -> bool {
    path.starts_with("\\\\") || path.starts_with("//")
}

fn modified_ns(metadata: &fs::Metadata) -> Option<u64> {
    let duration = metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    Some(duration.as_nanos().min(u64::MAX as u128) as u64)
}

fn file_mtime_ns(metadata: &fs::Metadata) -> u64 {
    modified_ns(metadata).unwrap_or(0)
}

fn read_record(
    path: &Path,
    expected_id: &str,
    _max_records: usize,
) -> Result<RecoveryRecord, LoadError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(LoadError::Io("文件不存在".into()))
        }
        Err(error) => return Err(LoadError::Io(error.to_string())),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > MAX_FILE as u64
    {
        return Err(LoadError::Corrupt("大小超限、链接或不是普通文件".into()));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .and_then(|file| file.take(MAX_FILE as u64 + 1).read_to_end(&mut bytes))
        .map_err(|error| LoadError::Io(error.to_string()))?;
    if bytes.len() > MAX_FILE {
        return Err(LoadError::Corrupt("文件超过上限".into()));
    }
    let record: RecoveryRecord = serde_json::from_slice(&bytes)
        .map_err(|error| LoadError::Corrupt(format!("JSON 无效: {error}")))?;
    validate_record(&record, expected_id).map_err(LoadError::Corrupt)?;
    Ok(record)
}

fn validate_record(record: &RecoveryRecord, expected_id: &str) -> Result<(), String> {
    if record.schema_version != SCHEMA_VERSION
        || record.id != expected_id
        || validate_id(&record.id).is_err()
    {
        return Err("版本或标识无效".into());
    }
    if record.text.len() > MAX_TEXT || record.checksum != checksum(&record.text) {
        return Err("正文超限或校验失败".into());
    }
    if record.char_count != record.text.chars().count() {
        return Err("字符计数不一致".into());
    }
    valid_name(&record.name)?;
    if let Some(path) = &record.path {
        valid_path(path)?;
    }
    valid_encoding(&record.encoding)?;
    valid_eol(&record.eol)?;
    if let Some(mode) = &record.mode {
        valid_mode(mode)?;
    }
    valid_panes(record.panes.clone())?;
    Ok(())
}

fn checksum(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn bounded_text<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    let text = String::deserialize(deserializer)?;
    if text.len() > MAX_TEXT {
        return Err(serde::de::Error::custom("恢复正文超过 8 MiB"));
    }
    Ok(text)
}

fn random_id() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| format!("生成恢复标识失败: {e}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.len() == 32 && id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("恢复标识无效".into())
    }
}

fn valid_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty()
        || name.len() > MAX_NAME
        || name
            .chars()
            .any(|ch| ch.is_control() || matches!(ch, '/' | '\\'))
    {
        return Err("恢复文档名无效".into());
    }
    Ok(name.to_owned())
}

fn valid_path(path: &str) -> Result<String, String> {
    let target = Path::new(path);
    if path.len() > MAX_PATH
        || path.contains('\0')
        || !target.is_absolute()
        || target.file_name().is_none()
        || target
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err("恢复快照中的原文件路径无效".into());
    }
    Ok(path.to_owned())
}

fn valid_encoding(encoding: &str) -> Result<String, String> {
    if ["UTF-8", "UTF-16LE", "UTF-16BE", "GB18030", "windows-1252"].contains(&encoding) {
        Ok(encoding.to_owned())
    } else {
        Err("恢复快照编码无效".into())
    }
}

fn valid_eol(eol: &str) -> Result<String, String> {
    if ["LF", "CRLF", "CR", "Mixed"].contains(&eol) {
        Ok(eol.to_owned())
    } else {
        Err("恢复快照换行类型无效".into())
    }
}

fn valid_mode(mode: &str) -> Result<String, String> {
    if ["live", "source", "split"].contains(&mode) {
        Ok(mode.to_owned())
    } else {
        Err("恢复快照 Markdown 模式无效".into())
    }
}

fn valid_panes(panes: Vec<RecoveryPane>) -> Result<Vec<RecoveryPane>, String> {
    if panes.len() > MAX_PANES {
        return Err("恢复快照分栏数量过多".into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for pane in panes {
        if pane.pane.is_empty()
            || pane.pane.len() > 128
            || pane.pane.chars().any(char::is_control)
            || !seen.insert(pane.pane.clone())
        {
            return Err("恢复快照分栏标识无效".into());
        }
        if let Some(mode) = &pane.mode {
            valid_mode(mode)?;
        }
        result.push(pane);
    }
    Ok(result)
}

fn quarantine(path: &Path, id: &str) -> bool {
    let stamp = now_ms();
    let target = path.with_file_name(format!("{id}.corrupt-{stamp}"));
    fs::rename(path, target).is_ok()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
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

#[cfg(test)]
thread_local! {
    static BEFORE_SNAPSHOT_WRITE: std::cell::RefCell<Option<Box<dyn FnOnce(&Path)>>> = std::cell::RefCell::new(None);
}
#[cfg(test)]
fn before_snapshot_write(path: &Path) {
    let hook = BEFORE_SNAPSHOT_WRITE.with(|slot| slot.borrow_mut().take());
    if let Some(hook) = hook {
        hook(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service() -> (tempfile::TempDir, RecoveryService) {
        let dir = tempfile::tempdir().unwrap();
        let mut service = RecoveryService::default();
        service.configure(dir.path().join("recovery"));
        (dir, service)
    }

    fn input(text: &str) -> RecoveryInput {
        RecoveryInput {
            id: None,
            name: "notes.txt".into(),
            path: None,
            text: text.into(),
            encoding: "UTF-8".into(),
            bom: false,
            eol: "LF".into(),
            mode: None,
            panes: vec![RecoveryPane {
                pane: "main".into(),
                mode: None,
            }],
            disk_version: None,
        }
    }

    #[test]
    fn same_snapshot_updates_a_b_c_and_restarts_with_exact_c() {
        let (dir, service) = service();
        let saved = service.save(input("A")).unwrap();
        let id = saved.record.id;
        for text in ["B", "C 中文\r\nlast"] {
            let mut update = input(text);
            update.id = Some(id.clone());
            service
                .save(update)
                .expect("existing snapshot must support conditional atomic update");
            assert_eq!(service.read(&id).unwrap().text, text);
        }
        drop(service);
        let mut restarted = RecoveryService::default();
        restarted.configure(dir.path().join("recovery"));
        let record = restarted.read(&id).unwrap();
        assert_eq!(record.text, "C 中文\r\nlast");
        assert_eq!(record.checksum, checksum(&record.text));
        assert_eq!(restarted.list().unwrap().records.len(), 1);
    }

    #[test]
    fn failed_second_write_preserves_exact_last_valid_snapshot() {
        use crate::files::atomic::fault;
        struct Reset;
        impl Drop for Reset {
            fn drop(&mut self) {
                fault::clear();
            }
        }
        for point in [
            fault::TEMP_CREATE,
            fault::TEMP_WRITE,
            fault::TEMP_SYNC,
            fault::REPLACE,
        ] {
            let (_dir, service) = service();
            let id = service.save(input("last valid A")).unwrap().record.id;
            let target = service.directory().unwrap().join(format!("{id}.json"));
            let before = fs::read(&target).unwrap();
            let mut update = input("new B must not be reported saved");
            update.id = Some(id.clone());
            fault::set(point);
            let reset = Reset;
            assert!(service.save(update).is_err());
            drop(reset);
            assert_eq!(
                fs::read(target).unwrap(),
                before,
                "fault {point} changed last valid bytes"
            );
            assert_eq!(service.read(&id).unwrap().text, "last valid A");
            let mut retry = input("successful retry C");
            retry.id = Some(id.clone());
            service.save(retry).unwrap();
            assert_eq!(service.read(&id).unwrap().text, "successful retry C");
        }
    }

    #[test]
    fn version_change_between_validation_and_commit_preserves_competing_valid_record() {
        let (_dir, service) = service();
        let id = service.save(input("A")).unwrap().record.id;
        let mut competing = service.read(&id).unwrap();
        competing.text = "external valid B".into();
        let competing = with_derived(&competing).unwrap();
        let bytes = serde_json::to_vec(&competing).unwrap();
        let injected = bytes.clone();
        BEFORE_SNAPSHOT_WRITE.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(move |target| {
                fs::write(target, &injected).unwrap()
            }))
        });
        let mut update = input("stale C");
        update.id = Some(id.clone());
        assert!(service.save(update).is_err());
        let target = service.directory().unwrap().join(format!("{id}.json"));
        assert_eq!(fs::read(target).unwrap(), bytes);
        assert_eq!(service.read(&id).unwrap().text, "external valid B");
    }

    #[test]
    fn deleted_snapshot_cannot_be_resurrected_by_a_late_update() {
        let (_dir, service) = service();
        let id = service.save(input("A")).unwrap().record.id;
        service.delete(&id).unwrap();
        let mut update = input("late B");
        update.id = Some(id.clone());
        assert!(service.save(update).unwrap_err().contains("已删除"));
        assert!(service.list().unwrap().records.is_empty());
    }

    #[test]
    fn concurrent_services_serialize_updates_and_delete_never_resurrects() {
        let (dir, service) = service();
        let id = service.save(input("A")).unwrap().record.id;
        let root = dir.path().join("recovery");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let guard = service.transaction().unwrap();
        let threads: Vec<_> = (0..2)
            .map(|i| {
                let root = root.clone();
                let id = id.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let mut service = RecoveryService::default();
                    service.configure(root);
                    barrier.wait();
                    if i == 0 {
                        let mut update = input("B");
                        update.id = Some(id);
                        let _ = service.save(update);
                    } else {
                        service.delete(&id).unwrap();
                    }
                })
            })
            .collect();
        barrier.wait();
        drop(guard);
        for thread in threads {
            thread.join().unwrap();
        }
        assert!(service.list().unwrap().records.is_empty());
    }

    #[test]
    fn concurrent_snapshot_updates_remain_valid_and_continue_after_restart() {
        let (dir, service) = service();
        let id = service.save(input("A")).unwrap().record.id;
        let root = dir.path().join("recovery");
        let threads: Vec<_> = (0..4)
            .map(|index| {
                let root = root.clone();
                let id = id.clone();
                std::thread::spawn(move || {
                    let mut s = RecoveryService::default();
                    s.configure(root);
                    for sequence in 0..4 {
                        let mut update = input(&format!("thread {index} sequence {sequence}"));
                        update.id = Some(id.clone());
                        s.save(update).unwrap();
                    }
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        let record = service.read(&id).unwrap();
        assert!(record.text.ends_with("sequence 3"));
        assert_eq!(record.checksum, checksum(&record.text));
        let mut restarted = RecoveryService::default();
        restarted.configure(root);
        let mut update = input("final C after restart");
        update.id = Some(id.clone());
        restarted.save(update).unwrap();
        assert_eq!(restarted.read(&id).unwrap().text, "final C after restart");
    }

    #[test]
    fn update_budget_failure_does_not_prune_its_own_last_valid_snapshot() {
        let (_dir, mut service) = service();
        let saved = service.save(input("A")).unwrap();
        let id = saved.record.id;
        service.limits = Limits {
            records: 1,
            total: saved.record.size_bytes + 16,
        };
        let mut update = input(&"B".repeat(1024));
        update.id = Some(id.clone());
        assert!(service.save(update).is_err());
        assert_eq!(service.read(&id).unwrap().text, "A");
        let mut update = input("C");
        update.id = Some(id.clone());
        service.save(update).unwrap();
        assert_eq!(service.read(&id).unwrap().text, "C");
    }

    #[test]
    fn external_reload_checkpoint_updates_exact_local_content_and_keeps_disk_conflict_guard() {
        let (dir, recovery) = service();
        let original = dir.path().join("original.md");
        fs::write(&original, "original disk A").unwrap();
        let mut files = crate::files::FileService::default();
        files.set_owner("recovery-integration");
        let opened = files.open_selected(original.clone(), None).unwrap();
        let mut id = None;
        for text in ["local A", "local B", "local C 中文\r\n"] {
            let mut snapshot = input(text);
            snapshot.id = id.clone();
            snapshot.path = Some(original.to_string_lossy().into_owned());
            snapshot.disk_version = Some(opened.metadata.version.clone());
            id = Some(recovery.save(snapshot).unwrap().record.id);
        }
        let id = id.unwrap();
        fs::write(&original, "new external disk B").unwrap();
        let version = files.check_external(&opened.metadata.token).unwrap();
        let loaded = files
            .read_external(&opened.metadata.token, &version, "UTF-8")
            .unwrap();
        assert_eq!(loaded.text, "new external disk B");
        // Reading the new disk body does not authorize a later save using the
        // original editor baseline, even when a recovery checkpoint exists.
        let error = files
            .save(
                &opened.metadata.token,
                "local C 中文\r\n",
                Some(&opened.metadata.version),
                "UTF-8",
                false,
            )
            .unwrap_err();
        assert_eq!(error.code, "conflict");
        assert_eq!(
            fs::read_to_string(&original).unwrap(),
            "new external disk B"
        );
        drop(recovery);
        let mut restarted = RecoveryService::default();
        restarted.configure(dir.path().join("recovery"));
        let record = restarted.read(&id).unwrap();
        assert_eq!(record.text, "local C 中文\r\n");
        assert_eq!(record.checksum, checksum(&record.text));
        assert_eq!(restarted.list().unwrap().records.len(), 1);
    }

    #[test]
    fn round_trip_writes_checksum_and_lists_summary() {
        let (_dir, service) = service();
        let saved = service.save(input("hello 世界\n")).unwrap();
        assert!(saved.record.id.len() == 32);
        let list = service.list().unwrap();
        assert_eq!(list.records.len(), 1);
        assert_eq!(list.records[0].char_count, 9);
        assert!(!list.records[0].disk_exists);
        let record = service.read(&saved.record.id).unwrap();
        assert_eq!(record.text, "hello 世界\n");
        assert_eq!(record.checksum, checksum(&record.text));
    }

    #[test]
    fn damaged_json_is_quarantined_and_never_listed() {
        let (_dir, service) = service();
        let dir = service.directory().unwrap();
        let id = "a".repeat(32);
        fs::write(dir.join(format!("{id}.json")), b"{not json").unwrap();
        let list = service.list().unwrap();
        assert!(list.records.is_empty());
        assert!(list.warnings.iter().any(|warning| warning.contains("损坏")));
        assert!(!dir.join(format!("{id}.json")).exists());
        assert!(fs::read_dir(&dir).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(&format!("{id}.corrupt-"))
        }));
    }

    #[test]
    fn checksum_mismatch_is_rejected() {
        let (_dir, service) = service();
        let saved = service.save(input("original")).unwrap();
        let path = service
            .directory()
            .unwrap()
            .join(format!("{}.json", saved.record.id));
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        value["text"] = serde_json::Value::String("tampered".into());
        fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(service.read(&saved.record.id).is_err());
        assert!(service.list().unwrap().records.is_empty());
    }

    #[test]
    fn temporary_files_are_not_valid_snapshots() {
        let (_dir, service) = service();
        let dir = service.directory().unwrap();
        fs::write(dir.join(format!("{}.json.tmp", "b".repeat(32))), b"partial").unwrap();
        assert!(service.list().unwrap().records.is_empty());
    }

    #[test]
    fn oversized_and_invalid_inputs_are_rejected() {
        let (_dir, service) = service();
        let mut oversized = input("x");
        oversized.text = "x".repeat(MAX_TEXT + 1);
        assert!(service.save(oversized).is_err());
        let mut relative = input("x");
        relative.path = Some("relative.txt".into());
        assert!(service.save(relative).is_err());
        let mut traversal = input("x");
        traversal.path = Some(
            std::env::temp_dir()
                .join("..")
                .join("escape.txt")
                .to_string_lossy()
                .into_owned(),
        );
        assert!(service.save(traversal).is_err());
        let mut bad_name = input("x");
        bad_name.name = "bad\nname".into();
        assert!(service.save(bad_name).is_err());
        assert!(service.read("not-an-id").is_err());
    }

    #[test]
    fn count_and_space_limits_prune_oldest_records() {
        let (_dir, mut service) = service();
        service.limits = Limits {
            records: 2,
            total: u64::MAX,
        };
        let first = service.save(input("one")).unwrap().record.id;
        std::thread::sleep(std::time::Duration::from_millis(2));
        let second = service.save(input("two")).unwrap().record.id;
        std::thread::sleep(std::time::Duration::from_millis(2));
        let third = service.save(input("three")).unwrap();
        assert!(third
            .warnings
            .iter()
            .any(|warning| warning.contains("已清理")));
        let list = service.list().unwrap();
        assert_eq!(list.records.len(), 2);
        assert!(!list.records.iter().any(|record| record.id == first));
        assert!(list.records.iter().any(|record| record.id == second));
        assert!(list
            .records
            .iter()
            .any(|record| record.id == third.record.id));
    }

    #[test]
    fn disk_state_detects_missing_and_changed_files() {
        let (dir, service) = service();
        let file = dir.path().join("note.txt");
        fs::write(&file, "disk text").unwrap();
        let mut input = input("recovery text");
        input.path = Some(file.to_string_lossy().into_owned());
        service.save(input).unwrap();
        let list = service.list().unwrap();
        assert!(list.records[0].disk_exists);
        assert!(!list.records[0].disk_changed);
        fs::write(&file, "disk text changed length").unwrap();
        let list = service.list().unwrap();
        assert!(list.records[0].disk_changed);
        fs::remove_file(&file).unwrap();
        let list = service.list().unwrap();
        assert!(!list.records[0].disk_exists);
        assert!(list.records[0].disk_changed);
    }

    #[test]
    fn delete_removes_record() {
        let (_dir, service) = service();
        let saved = service.save(input("body")).unwrap();
        service.delete(&saved.record.id).unwrap();
        assert!(service.list().unwrap().records.is_empty());
        service.delete(&saved.record.id).unwrap();
    }

    #[test]
    fn write_failure_reports_error_without_claiming_success() {
        let dir = tempfile::tempdir().unwrap();
        let blocker = dir.path().join("recovery");
        fs::write(&blocker, b"not a directory").unwrap();
        let mut service = RecoveryService::default();
        service.configure(blocker);
        assert!(service.save(input("cannot write")).is_err());
        assert!(service.list().is_err());
    }

    #[cfg(unix)]
    #[test]
    fn recovery_directory_and_files_are_private() {
        use std::os::unix::fs::PermissionsExt;
        let (_dir, service) = service();
        service.save(input("private")).unwrap();
        let dir = service.directory().unwrap();
        assert_eq!(
            fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
        let file = fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| path.extension().and_then(|ext| ext.to_str()) == Some("json"))
            .unwrap();
        assert_eq!(
            fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}

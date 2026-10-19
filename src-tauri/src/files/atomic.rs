use super::{fail, FileError, Result};
use std::{fs, io::Write, path::Path};

/// Deterministic fault injection for the save pipeline. These hooks are only
/// compiled into unit tests; production builds contain no failure branches.
#[cfg(test)]
mod fault {
    use std::cell::Cell;
    pub const TEMP_CREATE: u32 = 1 << 0;
    pub const TEMP_WRITE: u32 = 1 << 1;
    pub const TEMP_SYNC: u32 = 1 << 2;
    pub const REPLACE: u32 = 1 << 3;
    pub const RACE_TARGET: u32 = 1 << 4;
    pub const BACKUP_CREATE: u32 = 1 << 5;
    pub const TARGET_WRITE: u32 = 1 << 6;
    pub const TARGET_SYNC: u32 = 1 << 7;
    pub const PARTIAL_WRITE: u32 = 1 << 8;
    pub const ROLLBACK_FAIL: u32 = 1 << 9;

    thread_local! {
        static ACTIVE: Cell<u32> = const { Cell::new(0) };
    }

    pub fn set(bits: u32) {
        ACTIVE.with(|active| active.set(active.get() | bits));
    }
    pub fn clear() {
        ACTIVE.with(|active| active.set(0));
    }
    pub fn hit(bit: u32) -> bool {
        ACTIVE.with(|active| active.get() & bit != 0)
    }
    /// A one-shot fault, so a write failure can be followed by a successful
    /// rollback within the same test.
    pub fn take(bit: u32) -> bool {
        ACTIVE.with(|active| {
            let current = active.get();
            if current & bit == 0 {
                false
            } else {
                active.set(current & !bit);
                true
            }
        })
    }
}

fn save_error(error: std::io::Error, action: &str) -> FileError {
    #[cfg(windows)]
    if matches!(error.raw_os_error(), Some(32 | 33)) {
        return FileError::new(
            "file_locked",
            &format!("{action}：文件被其他程序占用，请关闭占用后重试。原文件未被截断。"),
        );
    }
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        return FileError::new("permission", &format!("{action}：当前应用进程没有写入权限。请检查目标文件/目录权限和应用进程权限，或另存到可写目录。原文件未被截断。"));
    }
    FileError::new("io", &format!("{action}：{error}"))
}

/// Atomic replacement by temp file + rename. Used for internal data (session,
/// preferences, recent files) where an interrupted write must never leave a
/// half-written file and the file's own identity does not matter.
///
/// User documents go through [`write_checked_preserving_identity`] instead.
pub fn write_checked(path: &Path, bytes: &[u8], expected: Option<&str>) -> Result<()> {
    // Resolve the target once. Internal callers such as the recent-file store
    // hand us the configured path verbatim, which may contain a linked config
    // directory (a POSIX symlink or a Windows junction); comparing that spelling
    // with the canonical path later would reject every save.
    let path = super::checked_path(path, true)?;
    if super::disk_version(&path)?.as_deref() != expected {
        return fail(
            "conflict",
            "磁盘文件已经变化或被删除；已阻止覆盖，请另存为或重新打开。",
        );
    }
    let parent = path
        .parent()
        .ok_or_else(|| FileError::new("path", "缺少父目录。"))?;
    let permissions = prepare_target(&path)?;
    #[cfg(test)]
    if fault::hit(fault::TEMP_CREATE) {
        return Err(save_error(
            std::io::Error::other("injected temp creation failure"),
            "无法在目标文件夹创建原子保存临时文件",
        ));
    }
    let mut temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| save_error(error, "无法在目标文件夹创建原子保存临时文件"))?;
    #[cfg(test)]
    if fault::hit(fault::TEMP_WRITE) {
        return Err(save_error(
            std::io::Error::other("injected temp write failure"),
            "写入保存临时文件失败",
        ));
    }
    temp.write_all(bytes)
        .map_err(|error| save_error(error, "写入保存临时文件失败"))?;
    if let Some(permissions) = permissions {
        temp.as_file()
            .set_permissions(permissions)
            .map_err(|error| save_error(error, "设置保存临时文件属性失败"))?;
    }
    #[cfg(windows)]
    let _disk_guard = if expected.is_some() {
        Some(open_write_guard(&path)?)
    } else {
        None
    };
    #[cfg(test)]
    if fault::hit(fault::TEMP_SYNC) {
        return Err(FileError::io(std::io::Error::other(
            "injected temporary-file fsync failure",
        )));
    }
    temp.as_file().sync_all().map_err(FileError::io)?;
    // Close the temporary file handle before Windows replacement. TempPath cleans
    // up failed writes; the existing file is never truncated in place.
    let temp = temp.into_temp_path();
    if super::checked_path(&path, true)? != path {
        return fail("scope", "保存目标父目录或链接已变化。");
    }
    if super::disk_version(&path)?.as_deref() != expected {
        return fail(
            "conflict",
            "磁盘文件已经变化或被删除；已阻止覆盖，请另存为或重新打开。",
        );
    }
    if expected.is_some()
        && fs::metadata(&path)
            .map_err(FileError::io)?
            .permissions()
            .readonly()
    {
        return fail("read_only", "文件为只读，不能覆盖；请另存为。");
    }
    // Simulate another process creating the new target after validation. The
    // no-overwrite branch must fail instead of replacing that file.
    #[cfg(test)]
    if expected.is_none() && fault::hit(fault::RACE_TARGET) {
        let _ = fs::write(&path, b"intruder");
    }
    #[cfg(test)]
    if fault::hit(fault::REPLACE) {
        return Err(save_error(
            std::io::Error::other("injected replace failure"),
            "替换保存目标失败",
        ));
    }
    replace(&temp, &path, expected.is_some()).map_err(FileError::io)?;
    #[cfg(unix)]
    fs::File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(FileError::io)?;
    Ok(())
}

/// Saves a user document while keeping the existing file's Windows identity.
///
/// A temp-file swap (`ReplaceFileW`) gives the directory entry a new identity,
/// which makes Explorer treat a Desktop file as a new item and reflow its icons.
/// Writing an existing file in place keeps the same file ID, creation time and
/// ACLs, so the shell item never moves.
///
/// Trade-offs, deliberately chosen and not claimed to be risk-free:
/// * An in-place write is **not atomic**: a power loss or hard reset in the
///   middle of the write can leave a truncated or partially updated file. There
///   is no way to both keep the file identity and get atomicity on NTFS; the
///   mitigation is the fsynced backup copy described below plus error reporting.
/// * Before touching the file, its full current content is copied to an fsynced
///   backup outside the target directory. A failed write is rolled back with it,
///   and a failed rollback keeps the backup and reports its path so no content
///   is silently lost.
/// * The file is opened read+write with sharing that excludes other writers for
///   the whole validation and write, and the on-disk version is re-verified from
///   the bytes read through that same handle, so an external change is still
///   detected and refused.
/// * Creating a brand-new file (Save As to a new path) stays fully atomic.
pub fn write_checked_preserving_identity(path: &Path, bytes: &[u8], expected: Option<&str>) -> Result<()> {
    let path = super::checked_path(path, true)?;
    // New targets have no identity to preserve: keep the atomic creation path.
    if expected.is_none() || !path.exists() {
        return write_checked(&path, bytes, expected);
    }
    if super::disk_version(&path)?.as_deref() != expected {
        return fail(
            "conflict",
            "磁盘文件已经变化或被删除；已阻止覆盖，请另存为或重新打开。",
        );
    }
    if super::checked_path(&path, true)? != path {
        return fail("scope", "保存目标父目录或链接已变化。");
    }
    #[cfg(windows)]
    {
        in_place_write(&path, bytes, expected)
    }
    #[cfg(not(windows))]
    {
        // POSIX rename is atomic and desktop shells do not key icon placement to
        // the inode, so the safer atomic replacement is kept off Windows.
        write_checked(&path, bytes, expected)
    }
}

/// Checks that the target may be overwritten and returns its current permissions.
fn prepare_target(path: &Path) -> Result<Option<fs::Permissions>> {
    if !path.exists() {
        return Ok(None);
    }
    let permissions = fs::metadata(path).map_err(FileError::io)?.permissions();
    if permissions.readonly() {
        return fail("read_only", "文件为只读，不能覆盖；请另存为。");
    }
    // Also check effective ACL/write permissions, without truncation.
    // On Windows do this before acquiring the read guard below.
    fs::OpenOptions::new()
        .write(true)
        .open(path)
        .map_err(|error| save_error(error, "无法写入目标文件"))?;
    Ok(Some(permissions))
}

#[cfg(windows)]
fn open_write_guard(path: &Path) -> Result<fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_DELETE, FILE_SHARE_READ};
    // Keep ordinary writers out during validation/replacement, while allowing
    // ReplaceFile's rename. External rename races still require native audit.
    fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_DELETE)
        .open(path)
        .map_err(FileError::io)
}

#[cfg(windows)]
fn in_place_write(path: &Path, bytes: &[u8], expected: Option<&str>) -> Result<()> {
    use std::io::Read;
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_DELETE, FILE_SHARE_READ};

    // Refuse a read-only file by name before attempting any write access so the
    // user gets the actionable "save as" message instead of a raw ACL error.
    if fs::metadata(path)
        .map_err(FileError::io)?
        .permissions()
        .readonly()
    {
        return fail("read_only", "文件为只读，不能覆盖；请另存为。");
    }
    let mut file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        // Exclude other writers for the whole validation and write. Readers and
        // the shell may still inspect the file.
        .share_mode(FILE_SHARE_READ | FILE_SHARE_DELETE)
        .open(path)
        .map_err(|error| save_error(error, "无法写入目标文件"))?;
    let metadata = file.metadata().map_err(FileError::io)?;
    let mut original = Vec::new();
    (&file)
        .take(super::MAX_BYTES + 1)
        .read_to_end(&mut original)
        .map_err(|error| save_error(error, "读取目标文件以校验版本失败"))?;
    if original.len() as u64 > super::MAX_BYTES {
        return fail("size", "目标文件超过 16 MiB，拒绝原位覆盖。");
    }
    // Re-verify the version from the bytes read through the same handle that will
    // be written, so an external change between the first check and this point is
    // still refused before anything is modified.
    if super::version_of(&original, metadata.modified().ok()) != expected.unwrap_or_default() {
        return fail("conflict", "磁盘文件已经变化或被删除；已阻止覆盖，请另存为或重新打开。");
    }
    // Recovery copy outside the target directory: never creates or removes an
    // entry next to the document, and stays usable if the write fails.
    #[cfg(test)]
    if fault::hit(fault::BACKUP_CREATE) {
        return Err(save_error(
            std::io::Error::other("injected backup creation failure"),
            "无法创建保存回滚备份",
        ));
    }
    let mut backup = tempfile::NamedTempFile::new_in(std::env::temp_dir())
        .map_err(|error| save_error(error, "无法创建保存回滚备份"))?;
    backup
        .write_all(&original)
        .map_err(|error| save_error(error, "写保存回滚备份失败"))?;
    backup.as_file().sync_all().map_err(FileError::io)?;

    #[cfg(test)]
    let injected_write_failure = fault::hit(fault::TARGET_WRITE);
    #[cfg(not(test))]
    let injected_write_failure = false;
    let write_result = if injected_write_failure {
        Err(std::io::Error::other("injected target write failure"))
    } else {
        replace_contents(&mut file, bytes)
    };
    if let Err(error) = write_result {
        // Roll back to the exact previous bytes while the handle is still open.
        return Err(match rollback(&mut file, &original) {
            Ok(()) => save_error(error, "写入目标文件失败，已回滚为保存前内容"),
            Err(restore) => {
                let kept = backup.keep().map(|(_, path)| path);
                let location = kept.map(|path| format!("；保存前内容备份保留在 {}", path.display())).unwrap_or_default();
                FileError::new("io", &format!("写入目标文件失败（{error}），且回滚失败（{restore}）{location}。请从该备份恢复文件。"))
            }
        });
    }
    Ok(())
}

#[cfg(windows)]
fn rollback(file: &mut fs::File, original: &[u8]) -> std::io::Result<()> {
    #[cfg(test)]
    if fault::hit(fault::ROLLBACK_FAIL) {
        return Err(std::io::Error::other("injected rollback failure"));
    }
    replace_contents(file, original)
}

/// Overwrites an open file from offset zero, truncates any leftover tail and
/// flushes to disk. Used for the write itself and for rollback.
#[cfg(windows)]
fn replace_contents(file: &mut fs::File, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::{Seek, SeekFrom};
    file.seek(SeekFrom::Start(0))?;
    #[cfg(test)]
    if fault::take(fault::PARTIAL_WRITE) {
        let prefix = bytes.len() / 2;
        file.write_all(&bytes[..prefix])?;
        file.set_len(prefix as u64)?;
        return Err(std::io::Error::other("injected partial write failure"));
    }
    file.write_all(bytes)?;
    file.set_len(bytes.len() as u64)?;
    #[cfg(test)]
    if fault::take(fault::TARGET_SYNC) {
        return Err(std::io::Error::other("injected target fsync failure"));
    }
    file.sync_all()
}

#[cfg(windows)]
fn replace(source: &Path, target: &Path, exists: bool) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, ReplaceFileW, MOVEFILE_WRITE_THROUGH,
    };
    let wide = |path: &Path| {
        path.as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<u16>>()
    };
    let source_w = wide(source);
    let target_w = wide(target);
    // ReplaceFile preserves the original Windows ACL. A same-directory backup
    // also allows recovery if Windows reports a partially completed replacement.
    let backup_dir = tempfile::tempdir_in(target.parent().unwrap())?;
    let backup = backup_dir.path().join("original");
    let backup_w = wide(&backup);
    let ok = unsafe {
        if exists {
            ReplaceFileW(
                target_w.as_ptr(),
                source_w.as_ptr(),
                backup_w.as_ptr(),
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        } else {
            MoveFileExW(source_w.as_ptr(), target_w.as_ptr(), MOVEFILE_WRITE_THROUGH)
        }
    };
    if ok == 0 {
        let error = std::io::Error::last_os_error();
        if backup.exists() {
            // Preserve a backup on failure, including unusual ReplaceFile error
            // states. Do not delete the only recoverable original.
            let recovery = backup_dir.keep();
            return Err(std::io::Error::new(
                error.kind(),
                format!("{error}; 原文件备份保留在 {}", recovery.display()),
            ));
        }
        return Err(error);
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace(source: &Path, target: &Path, exists: bool) -> std::io::Result<()> {
    if exists {
        fs::rename(source, target)
    } else {
        fs::hard_link(source, target)
    } // fail atomically if another file appeared
}

#[cfg(test)]
mod save_safety_tests {
    use super::*;

    fn existing_target(dir: &tempfile::TempDir, name: &str, text: &[u8]) -> (std::path::PathBuf, String) {
        let path = dir.path().join(name);
        fs::write(&path, text).unwrap();
        let version = super::super::disk_version(&path).unwrap().unwrap();
        (path, version)
    }

    #[cfg(windows)]
    fn link_directory(link: &Path, target: &Path) -> bool {
        // Creating a real symlink requires an elevated token or Developer Mode.
        // A junction exercises the same canonicalization path without elevation.
        std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|status| status.success() && link.exists())
            .unwrap_or(false)
    }

    #[cfg(unix)]
    fn link_directory(link: &Path, target: &Path) -> bool {
        std::os::unix::fs::symlink(target, link).is_ok()
    }

    #[test]
    fn atomic_write_accepts_a_linked_configuration_parent() {
        let directory = tempfile::tempdir().unwrap();
        let real = directory.path().join("real");
        let link = directory.path().join("link");
        fs::create_dir(&real).unwrap();
        if !link_directory(&link, &real) {
            return;
        }
        let path = link.join("files.json");
        write_checked(&path, b"first", None).unwrap();
        assert_eq!(fs::read(real.join("files.json")).unwrap(), b"first");

        let version = super::super::disk_version(&path).unwrap();
        write_checked(&path, b"second", version.as_deref()).unwrap();
        assert_eq!(fs::read(real.join("files.json")).unwrap(), b"second");
    }

    #[test]
    fn atomic_temp_failures_keep_the_existing_target_intact() {
        for point in [
            fault::TEMP_CREATE,
            fault::TEMP_WRITE,
            fault::TEMP_SYNC,
            fault::REPLACE,
        ] {
            let directory = tempfile::tempdir().unwrap();
            let (path, version) = existing_target(&directory, "data.json", b"original");
            fault::clear();
            fault::set(point);
            let result = write_checked(&path, b"replacement", Some(&version));
            fault::clear();
            assert!(result.is_err(), "fault point {point} did not fail the save");
            assert_eq!(fs::read(&path).unwrap(), b"original", "fault point {point} changed the target");
        }
    }

    #[test]
    fn a_new_target_created_after_validation_is_never_overwritten() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("new.json");
        fault::clear();
        fault::set(fault::RACE_TARGET);
        let result = write_checked(&path, b"editor", None);
        fault::clear();
        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"intruder");
    }

    #[cfg(windows)]
    #[test]
    fn backup_creation_failure_keeps_the_original_document() {
        let directory = tempfile::tempdir().unwrap();
        let (path, version) = existing_target(&directory, "note.txt", b"original");
        fault::clear();
        fault::set(fault::BACKUP_CREATE);
        let result = write_checked_preserving_identity(&path, b"replacement", Some(&version));
        fault::clear();
        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
    }

    #[cfg(windows)]
    #[test]
    fn write_failure_and_partial_write_are_rolled_back() {
        for point in [fault::TARGET_WRITE, fault::PARTIAL_WRITE, fault::TARGET_SYNC] {
            let directory = tempfile::tempdir().unwrap();
            let (path, version) = existing_target(&directory, "note.txt", b"original content");
            fault::clear();
            fault::set(point);
            let result = write_checked_preserving_identity(&path, b"replacement content", Some(&version));
            fault::clear();
            assert!(result.is_err(), "fault point {point} did not fail the write");
            assert_eq!(
                fs::read(&path).unwrap(),
                b"original content",
                "fault point {point} did not roll back"
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn failed_rollback_keeps_a_readable_backup_and_reports_its_path() {
        let directory = tempfile::tempdir().unwrap();
        let (path, version) = existing_target(&directory, "note.txt", b"recoverable original");
        fault::clear();
        fault::set(fault::PARTIAL_WRITE | fault::ROLLBACK_FAIL);
        let error = write_checked_preserving_identity(&path, b"replacement", Some(&version)).unwrap_err();
        fault::clear();
        assert!(error.message.contains("备份保留在"), "{}", error.message);
        let location = error.message.split("备份保留在 ").nth(1).unwrap();
        let backup = location.split('。').next().unwrap();
        assert_eq!(fs::read(backup).unwrap(), b"recoverable original");
        fs::remove_file(backup).unwrap();
    }
}

use super::{fail, FileError, Result};
use std::{fs, io::Write, path::Path};

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
    if super::disk_version(path)?.as_deref() != expected {
        return fail(
            "conflict",
            "磁盘文件已经变化或被删除；已阻止覆盖，请另存为或重新打开。",
        );
    }
    let parent = path
        .parent()
        .ok_or_else(|| FileError::new("path", "缺少父目录。"))?;
    let permissions = prepare_target(path)?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| save_error(error, "无法在目标文件夹创建原子保存临时文件"))?;
    temp.write_all(bytes)
        .map_err(|error| save_error(error, "写入保存临时文件失败"))?;
    if let Some(permissions) = permissions {
        temp.as_file()
            .set_permissions(permissions)
            .map_err(|error| save_error(error, "设置保存临时文件属性失败"))?;
    }
    #[cfg(windows)]
    let _disk_guard = if expected.is_some() {
        Some(open_write_guard(path)?)
    } else {
        None
    };
    temp.as_file().sync_all().map_err(FileError::io)?;
    // Close the temporary file handle before Windows replacement. TempPath cleans
    // up failed writes; the existing file is never truncated in place.
    let temp = temp.into_temp_path();
    if super::checked_path(path, true)? != path {
        return fail("scope", "保存目标父目录或链接已变化。");
    }
    if super::disk_version(path)?.as_deref() != expected {
        return fail(
            "conflict",
            "磁盘文件已经变化或被删除；已阻止覆盖，请另存为或重新打开。",
        );
    }
    if expected.is_some()
        && fs::metadata(path)
            .map_err(FileError::io)?
            .permissions()
            .readonly()
    {
        return fail("read_only", "文件为只读，不能覆盖；请另存为。");
    }
    replace(&temp, path, expected.is_some()).map_err(FileError::io)?;
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
    // New targets have no identity to preserve: keep the atomic creation path.
    if expected.is_none() || !path.exists() {
        return write_checked(path, bytes, expected);
    }
    if super::disk_version(path)?.as_deref() != expected {
        return fail(
            "conflict",
            "磁盘文件已经变化或被删除；已阻止覆盖，请另存为或重新打开。",
        );
    }
    if super::checked_path(path, true)? != path {
        return fail("scope", "保存目标父目录或链接已变化。");
    }
    #[cfg(windows)]
    {
        in_place_write(path, bytes, expected)
    }
    #[cfg(not(windows))]
    {
        // POSIX rename is atomic and desktop shells do not key icon placement to
        // the inode, so the safer atomic replacement is kept off Windows.
        write_checked(path, bytes, expected)
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
    let mut backup = tempfile::NamedTempFile::new_in(std::env::temp_dir())
        .map_err(|error| save_error(error, "无法创建保存回滚备份"))?;
    backup
        .write_all(&original)
        .map_err(|error| save_error(error, "写保存回滚备份失败"))?;
    backup.as_file().sync_all().map_err(FileError::io)?;

    if let Err(error) = replace_contents(&mut file, bytes) {
        // Roll back to the exact previous bytes while the handle is still open.
        return Err(match replace_contents(&mut file, &original) {
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

/// Overwrites an open file from offset zero, truncates any leftover tail and
/// flushes to disk. Used for the write itself and for rollback.
#[cfg(windows)]
fn replace_contents(file: &mut fs::File, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::{Seek, SeekFrom};
    file.seek(SeekFrom::Start(0))?;
    file.write_all(bytes)?;
    file.set_len(bytes.len() as u64)?;
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

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION};

    /// File index and creation time, the two identity fields Explorer uses when
    /// it decides whether a Desktop item is the same file or a new one.
    fn identity(path: &std::path::Path) -> (u64, u64) {
        let file = fs::File::open(path).unwrap();
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        assert_ne!(unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut info) }, 0);
        let index = ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64;
        let created = ((info.ftCreationTime.dwHighDateTime as u64) << 32) | info.ftCreationTime.dwLowDateTime as u64;
        (index, created)
    }

    fn version_of_file(path: &std::path::Path) -> String {
        let bytes = fs::read(path).unwrap();
        let modified = fs::metadata(path).unwrap().modified().ok();
        super::super::version_of(&bytes, modified)
    }

    /// Callers always pass the canonical path (it comes from a validated grant).
    fn canonical(path: &std::path::Path) -> std::path::PathBuf {
        super::super::checked_path(path, true).unwrap()
    }

    #[test]
    fn in_place_save_keeps_file_identity_creation_time_and_neighbours() {
        let dir = tempfile::tempdir().unwrap();
        let path = canonical(&dir.path().join("台面 图标.txt"));
        fs::write(&path, "保存前内容\r\n".as_bytes()).unwrap();
        let before = identity(&path);
        let expected = version_of_file(&path);

        super::write_checked_preserving_identity(&path, "保存后更长的内容\r\n第二行".as_bytes(), Some(&expected)).unwrap();

        assert_eq!(identity(&path), before, "写入必须保持文件 ID 与创建时间，否则桌面图标会移动");
        assert_eq!(fs::read_to_string(&path).unwrap(), "保存后更长的内容\r\n第二行");
        // Nothing may be created or removed beside the document.
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn in_place_save_truncates_growth_and_shrink_and_leaves_no_tail() {
        let dir = tempfile::tempdir().unwrap();
        let path = canonical(&dir.path().join("tail.txt"));
        let long = "L".repeat(4096);
        fs::write(&path, long.as_bytes()).unwrap();
        let before = identity(&path);
        super::write_checked_preserving_identity(&path, b"short", Some(&version_of_file(&path))).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"short");
        assert_eq!(identity(&path).0, before.0);
        // Growing again keeps the same identity and the exact new bytes.
        super::write_checked_preserving_identity(&path, &vec![b'G'; 2048], Some(&version_of_file(&path))).unwrap();
        assert_eq!(fs::read(&path).unwrap(), vec![b'G'; 2048]);
        assert_eq!(identity(&path).0, before.0);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn in_place_save_refuses_a_stale_version_without_touching_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = canonical(&dir.path().join("stale.txt"));
        fs::write(&path, b"original").unwrap();
        let stale = version_of_file(&path);
        fs::write(&path, b"changed outside").unwrap();
        let error = super::write_checked_preserving_identity(&path, b"mine", Some(&stale)).unwrap_err();
        assert_eq!(error.code, "conflict");
        assert_eq!(fs::read(&path).unwrap(), b"changed outside");
    }

    #[test]
    fn in_place_save_reports_read_only_without_modifying_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = canonical(&dir.path().join("locked.txt"));
        fs::write(&path, b"keep me").unwrap();
        let expected = version_of_file(&path);
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&path, permissions).unwrap();
        let result = super::write_checked_preserving_identity(&path, b"mine", Some(&expected));
        let mut restore = fs::metadata(&path).unwrap().permissions();
        restore.set_readonly(false);
        fs::set_permissions(&path, restore).unwrap();
        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"keep me");
    }

    #[test]
    fn rollback_primitive_restores_the_exact_previous_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = canonical(&dir.path().join("rollback.txt"));
        let original = "原始内容 with a longer tail".as_bytes().to_vec();
        fs::write(&path, &original).unwrap();
        let mut file = fs::OpenOptions::new().read(true).write(true).open(&path).unwrap();
        // A partially applied write, then the recovery step the saver performs.
        super::replace_contents(&mut file, b"partial").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"partial");
        super::replace_contents(&mut file, &original).unwrap();
        drop(file);
        assert_eq!(fs::read(&path).unwrap(), original);
    }

    #[test]
    fn new_targets_still_use_the_atomic_creation_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = canonical(&dir.path().join("fresh.txt"));
        super::write_checked_preserving_identity(&path, b"brand new", None).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"brand new");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}

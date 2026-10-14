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
    let permissions = if path.exists() {
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
        Some(permissions)
    } else {
        None
    };
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
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_DELETE, FILE_SHARE_READ};
        // Keep ordinary writers out during validation/replacement, while allowing
        // ReplaceFile's rename. External rename races still require native audit.
        Some(
            fs::OpenOptions::new()
                .read(true)
                .share_mode(FILE_SHARE_READ | FILE_SHARE_DELETE)
                .open(path)
                .map_err(FileError::io)?,
        )
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
    let current = super::disk_version(path)?;
    if current.as_deref() != expected {
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

use super::*;

#[test]
fn explorer_reveal_requires_a_live_validated_file_grant() {
    let (_dir, path, mut service, file) = fixture(b"source");
    assert!(service.revealed_path(path.to_str().unwrap()).is_err());
    assert!(service.revealed_path(&file.metadata.token).is_ok());
    service.release(&file.metadata.token);
    assert!(service.revealed_path(&file.metadata.token).is_err());
}

#[test]
fn workspace_rename_keeps_grant_saveable() {
    let (_dir, old, mut service, file) = fixture(b"original");
    let new = old.with_file_name("renamed.txt");
    fs::rename(&old, &new).unwrap();
    service.update_grant_path(&old, &new);
    service.save(&file.metadata.token, "updated", Some(&file.metadata.version), "UTF-8", false).unwrap();
    assert_eq!(fs::read_to_string(&new).unwrap(), "updated");
    assert!(!old.exists());
}

fn fixture(bytes: &[u8]) -> (tempfile::TempDir, PathBuf, FileService, OpenFile) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("中文 fixture.txt");
    fs::write(&path, bytes).unwrap();
    let mut service = FileService::default();
    let file = service.open_selected(path.clone(), None).unwrap();
    (dir, path, service, file)
}

#[test]
fn utf8_bom_crlf_chinese_and_no_final_newline_round_trip() {
    let source = "中文\r\n第二行🚀";
    let bytes = codec::encode(source, "UTF-8", true).unwrap();
    let (_dir, path, mut service, file) = fixture(&bytes);
    assert_eq!(file.text, source); assert!(file.metadata.bom); assert_eq!(file.metadata.eol, "CRLF");
    let next = format!("{source}修改");
    let saved = service.save(&file.metadata.token, &next, Some(&file.metadata.version), "UTF-8", true).unwrap();
    assert_eq!(fs::read(path).unwrap(), codec::encode(&next, "UTF-8", true).unwrap());
    assert_ne!(saved.version, file.metadata.version);
}

#[test]
fn utf16_le_be_bom_surrogate_pairs_and_mixed_eol_round_trip() {
    for label in ["UTF-16LE", "UTF-16BE"] {
        let text = "中文🚀\r\n第二行\n第三行\r";
        let bytes = codec::encode(text, label, true).unwrap();
        let (_dir, path, mut service, file) = fixture(&bytes);
        assert_eq!(file.metadata.encoding, label); assert_eq!(file.metadata.eol, "Mixed"); assert_eq!(file.text, text);
        service.save(&file.metadata.token, text, Some(&file.metadata.version), label, true).unwrap();
        assert_eq!(fs::read(path).unwrap(), bytes);
    }
}

#[test]
fn explicit_legacy_encoding_and_lossy_save_rejection() {
    let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("legacy.txt");
    let text = "中文测试"; let bytes = codec::encode(text, "GB18030", false).unwrap();
    fs::write(&path, &bytes).unwrap(); let mut service = FileService::default();
    assert_eq!(service.open_selected(path.clone(), None).unwrap_err().code, "encoding");
    let file = service.open_selected(path.clone(), Some("GB18030")).unwrap();
    assert_eq!(file.metadata.encoding, "GB18030"); assert_eq!(file.text, text);
    service.save(&file.metadata.token, text, Some(&file.metadata.version), "GB18030", false).unwrap();
    assert_eq!(fs::read(&path).unwrap(), bytes);
    assert_eq!(codec::encode("中文🚀", "windows-1252", false).unwrap_err().code, "encoding_loss");
    assert!(codec::decode(&[0xff, 0xfe, 0x00], None).is_err());
    assert!(codec::decode(&[0xef, 0xbb, 0xbf, b'a'], Some("windows-1252")).is_err());
}

#[test]
fn external_change_same_length_and_deleted_file_never_overwritten() {
    let (_dir, path, mut service, file) = fixture(b"original");
    fs::write(&path, b"external").unwrap();
    let error = service.save(&file.metadata.token, "my edit", Some(&file.metadata.version), "UTF-8", false).unwrap_err();
    assert_eq!(error.code, "conflict"); assert_eq!(fs::read(&path).unwrap(), b"external");
    fs::remove_file(&path).unwrap();
    assert_eq!(service.save(&file.metadata.token, "my edit", Some(&file.metadata.version), "UTF-8", false).unwrap_err().code, "conflict");
    assert!(!path.exists());
}

#[test]
fn read_only_save_preserves_original() {
    let (_dir, path, mut service, file) = fixture(b"readonly");
    let original_permissions = fs::metadata(&path).unwrap().permissions();
    let mut permissions = original_permissions.clone(); permissions.set_readonly(true); fs::set_permissions(&path, permissions).unwrap();
    let result = service.save(&file.metadata.token, "edit", Some(&file.metadata.version), "UTF-8", false);
    // Restore exact fixture permissions even when the assertion fails.
    fs::set_permissions(&path, original_permissions).unwrap();
    assert!(result.is_err()); assert_eq!(fs::read(&path).unwrap(), b"readonly");
}

#[test]
fn save_as_new_collision_and_concurrent_creation() {
    let dir = tempfile::tempdir().unwrap(); let target = dir.path().join("new.txt"); let mut service = FileService::default();
    let prepared = service.prepare_target(target.clone(), None).unwrap(); assert!(prepared.version.is_none());
    fs::write(&target, b"another process").unwrap();
    assert_eq!(service.save(&prepared.token, "mine", None, "UTF-8", false).unwrap_err().code, "conflict");
    assert_eq!(fs::read(&target).unwrap(), b"another process");
    service.release(&prepared.token); fs::remove_file(&target).unwrap();
    let prepared = service.prepare_target(target.clone(), None).unwrap();
    service.save(&prepared.token, "new content", None, "UTF-8", false).unwrap();
    assert_eq!(fs::read(&target).unwrap(), b"new content");
    assert_eq!(service.prepare_target(target, None).unwrap_err().code, "already_open");
}

#[test]
fn user_selected_existing_target_must_match_confirmed_version() {
    let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("existing.txt"); fs::write(&path, b"existing").unwrap();
    let mut service = FileService::default(); let target = service.prepare_target(path.clone(), None).unwrap();
    fs::write(&path, b"changed after dialog").unwrap();
    assert_eq!(service.save(&target.token, "mine", target.version.as_deref(), "UTF-8", false).unwrap_err().code, "conflict");
    assert_eq!(fs::read(path).unwrap(), b"changed after dialog");
}

#[test]
fn arbitrary_path_token_and_released_grant_are_denied() {
    let (_dir, path, mut service, file) = fixture(b"safe");
    assert_eq!(service.save("made-up-token", "overwrite", Some(&file.metadata.version), "UTF-8", false).unwrap_err().code, "scope");
    assert_eq!(service.open_recent("C:\\unselected.txt", None).unwrap_err().code, "scope");
    service.release(&file.metadata.token);
    assert_eq!(service.reopen(&file.metadata.token, "UTF-8").unwrap_err().code, "scope");
    assert_eq!(fs::read(path).unwrap(), b"safe");
    assert!(checked_path(Path::new("../secret.txt"), true).is_err());
}

#[test]
fn recent_and_single_file_layout_are_persisted_without_text() {
    let dir = tempfile::tempdir().unwrap(); let prefs = dir.path().join("app-data").join("files.json");
    let path = dir.path().join("notes.txt"); fs::write(&path, b"private-content").unwrap();
    let mut service = FileService::default(); service.configure(prefs.clone());
    service.open_selected(path.clone(), None).unwrap();
    service.set_layout(Layout { mode: "single".into(), sidebar_visible: false, sidebar_width: 300 }).unwrap();
    let json = fs::read_to_string(&prefs).unwrap(); assert!(!json.contains("private-content"));
    let mut next = FileService::default(); next.configure(prefs);
    assert_eq!(next.preferences.layout.sidebar_width, 300);
    assert_eq!(next.open_recent(&fs::canonicalize(path).unwrap().to_string_lossy(), None).unwrap().text, "private-content");
}

#[test]
fn binary_and_oversized_file_are_rejected_without_changes() {
    let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("large.txt");
    let file = fs::File::create(&path).unwrap(); file.set_len(MAX_BYTES + 1).unwrap(); drop(file);
    let mut service = FileService::default(); assert_eq!(service.open_selected(path.clone(), None).unwrap_err().code, "size");
    assert_eq!(fs::metadata(path).unwrap().len(), MAX_BYTES + 1);
    assert_eq!(codec::decode(b"binary\0data", None).unwrap_err().code, "binary");
}

#[test]
fn hard_links_are_rejected_and_reopen_uses_independent_grants() {
    let (dir, path, mut service, file) = fixture(b"source");
    let reopened = service.open_selected(path.clone(), None).unwrap();
    assert_ne!(file.metadata.token, reopened.metadata.token);
    service.release(&file.metadata.token);
    service.save(&reopened.metadata.token, "new", Some(&reopened.metadata.version), "UTF-8", false).unwrap();
    fs::hard_link(&path, dir.path().join("hard-link.txt")).unwrap();
    assert_eq!(service.open_selected(path.clone(), None).unwrap_err().code, "path");
    assert_eq!(fs::read(path).unwrap(), b"new");
}

#[cfg(windows)]
#[test]
fn windows_exclusive_file_lock_preserves_original() {
    use std::os::windows::fs::OpenOptionsExt;
    let (_dir, path, mut service, file) = fixture(b"locked original");
    let locked = fs::OpenOptions::new().read(true).write(true).share_mode(0).open(&path).unwrap();
    let result = service.save(&file.metadata.token, "edit", Some(&file.metadata.version), "UTF-8", false);
    drop(locked); assert!(result.is_err()); assert_eq!(fs::read(path).unwrap(), b"locked original");
}

#[cfg(windows)]
#[test]
fn windows_acl_denies_write_without_losing_original() {
    use std::process::Command;
    let (_dir, path, mut service, file) = fixture(b"ACL protected");
    for rights in ["(W,D)", "(R)"] {
        let deny = Command::new("icacls").arg(&path).arg("/deny").arg(format!("*S-1-1-0:{rights}")).output().unwrap();
        assert!(deny.status.success(), "{}", String::from_utf8_lossy(&deny.stderr));
        let denied = if rights == "(R)" { service.open_selected(path.clone(), None).is_err() }
            else { service.save(&file.metadata.token, "edit", Some(&file.metadata.version), "UTF-8", false).is_err() };
        let restore = Command::new("icacls").arg(&path).args(["/remove:d", "*S-1-1-0"]).output().unwrap();
        assert!(restore.status.success(), "fixture ACL cleanup failed");
        assert!(denied); assert_eq!(fs::read(&path).unwrap(), b"ACL protected");
    }
}

#[cfg(windows)]
#[test]
fn unwritable_parent_reports_save_stage_and_keeps_original_without_fallback() {
    use std::process::Command;
    let (dir, path, mut service, file) = fixture(b"protected original");
    // Deny adding a sibling file only; the original remains individually writable.
    let denied = Command::new("icacls").arg(dir.path()).args(["/deny", "*S-1-1-0:(WD)"]).output().unwrap();
    assert!(denied.status.success());
    let result = service.save(&file.metadata.token, "must not overwrite", Some(&file.metadata.version), "UTF-8", false);
    let restored = Command::new("icacls").arg(dir.path()).args(["/remove:d", "*S-1-1-0"]).output().unwrap();
    assert!(restored.status.success(), "fixture ACL cleanup failed");
    let error = result.unwrap_err();
    assert_eq!(error.code, "permission");
    assert!(error.message.contains("目标文件夹创建原子保存临时文件"));
    assert_eq!(fs::read(&path).unwrap(), b"protected original");
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[cfg(unix)]
#[test]
fn symlink_leaf_and_retargeted_parent_denied() {
    use std::os::unix::fs::symlink;
    let dir = tempfile::tempdir().unwrap(); let a = dir.path().join("a"); let b = dir.path().join("b");
    fs::create_dir(&a).unwrap(); fs::create_dir(&b).unwrap(); fs::write(a.join("file.txt"), b"a").unwrap(); fs::write(b.join("file.txt"), b"b").unwrap();
    let leaf = dir.path().join("leaf.txt"); symlink(a.join("file.txt"), &leaf).unwrap();
    let mut service = FileService::default(); assert_eq!(service.open_selected(leaf, None).unwrap_err().code, "path");
    let parent = dir.path().join("alias"); symlink(&a, &parent).unwrap(); let file = service.open_selected(parent.join("file.txt"), None).unwrap();
    fs::remove_file(&parent).unwrap(); symlink(&b, &parent).unwrap();
    assert_eq!(service.save(&file.metadata.token, "overwrite", Some(&file.metadata.version), "UTF-8", false).unwrap_err().code, "scope");
    assert_eq!(fs::read(b.join("file.txt")).unwrap(), b"b");
}

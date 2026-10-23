use super::*;

#[test]
fn own_saves_use_native_baselines_preserve_windows_identity_and_reject_later_writers() {
    let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("note.md");
    fs::write(&path, "original").unwrap();
    let mut s = FileService::default(); s.set_owner("first");
    let opened = s.open_selected(path.clone(), None).unwrap();
    let token = &opened.metadata.token; let mut version = opened.metadata.version;
    #[cfg(windows)]
    let identity = file_identity(&path);
    for n in 0..10 {
        let text = format!("# own save {n}");
        let saved = s.save(token, &text, Some(&version), "UTF-8", false).unwrap();
        version = saved.version;
        assert_eq!(s.check_external(token).unwrap(), version);
        assert_eq!(fs::read_to_string(&path).unwrap(), text);
        #[cfg(windows)]
        assert_eq!(file_identity(&path), identity);
    }
    // Each window has its own authority; observations never acknowledge a
    // different window's saved baseline or relax its conditional write.
    s.set_owner("second");
    assert_eq!(s.check_external(token).unwrap_err().code, "scope");
    let second = s.open_selected(path.clone(), None).unwrap();
    s.save(&second.metadata.token, "second window", Some(&second.metadata.version), "UTF-8", false).unwrap();
    s.set_owner("first");
    assert_eq!(s.save(token, "stale first", Some(&version), "UTF-8", false).unwrap_err().code, "conflict");
    assert_eq!(fs::read_to_string(&path).unwrap(), "second window");
}

#[test]
fn metadata_only_change_and_same_metadata_different_content_keep_sha256_protection() {
    let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("note.txt");
    fs::write(&path, "one").unwrap();
    let mut s = FileService::default(); s.set_owner("a");
    let opened = s.open_selected(path.clone(), None).unwrap(); let token = &opened.metadata.token;
    let changed_time = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
    fs::File::options().write(true).open(&path).unwrap().set_times(fs::FileTimes::new().set_modified(changed_time)).unwrap();
    let metadata_version = s.check_external(token).unwrap();
    assert_ne!(metadata_version, opened.metadata.version);
    assert_eq!(metadata_version.split(':').take(2).collect::<Vec<_>>(), opened.metadata.version.split(':').take(2).collect::<Vec<_>>());
    // The frontend may acknowledge the SHA-equal metadata version, then save
    // with that exact version. Native validation never uses size/mtime alone.
    fs::write(&path, "two").unwrap();
    fs::File::options().write(true).open(&path).unwrap().set_times(fs::FileTimes::new().set_modified(changed_time)).unwrap();
    assert_ne!(s.check_external(token).unwrap(), metadata_version);
    assert_eq!(s.save(token, "local", Some(&metadata_version), "UTF-8", false).unwrap_err().code, "conflict");
    assert_eq!(fs::read_to_string(&path).unwrap(), "two");
}

#[test]
fn failed_native_io_is_retryable_without_releasing_or_regranting_the_token() {
    let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("note.txt");
    fs::write(&path, "original").unwrap();
    let mut s = FileService::default(); s.set_owner("a");
    let opened = s.open_selected(path.clone(), None).unwrap(); let token = &opened.metadata.token;
    #[cfg(windows)]
    atomic::fault::set(atomic::fault::BACKUP_CREATE);
    #[cfg(not(windows))]
    atomic::fault::set(atomic::fault::TEMP_CREATE);
    let failure = s.save(token, "local", Some(&opened.metadata.version), "UTF-8", false);
    atomic::fault::clear();
    assert_eq!(failure.unwrap_err().code, "io");
    assert_eq!(s.check_external(token).unwrap(), opened.metadata.version);
    assert_eq!(fs::read_to_string(&path).unwrap(), "original");
    let saved = s.save(token, "retry", Some(&opened.metadata.version), "UTF-8", false).unwrap();
    assert_eq!(saved.token, *token); assert_eq!(s.check_external(token).unwrap(), saved.version);
    assert_eq!(fs::read_to_string(&path).unwrap(), "retry");
}

#[cfg(windows)]
#[test]
fn native_permission_and_sharing_errors_allow_retry_with_the_same_baseline() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("note.txt");
    fs::write(&path, "original").unwrap();
    let mut s = FileService::default(); s.set_owner("a");
    let opened = s.open_selected(path.clone(), None).unwrap(); let token = &opened.metadata.token;
    let permissions = fs::metadata(&path).unwrap().permissions();
    let mut readonly = permissions.clone(); readonly.set_readonly(true);
    fs::set_permissions(&path, readonly).unwrap();
    let failure = s.save(token, "local", Some(&opened.metadata.version), "UTF-8", false);
    fs::set_permissions(&path, permissions).unwrap();
    assert_eq!(failure.unwrap_err().code, "read_only");
    let guard = fs::OpenOptions::new().read(true).share_mode(1).open(&path).unwrap();
    assert!(s.save(token, "local", Some(&opened.metadata.version), "UTF-8", false).is_err());
    drop(guard);
    assert_eq!(fs::read_to_string(&path).unwrap(), "original");
    let saved = s.save(token, "retry", Some(&opened.metadata.version), "UTF-8", false).unwrap();
    assert_eq!(s.check_external(token).unwrap(), saved.version);
}

#[test]
fn large_native_check_and_save_complete_with_content_protection_without_a_watcher() {
    let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("large.md");
    let text = format!("# large {}\n", "a".repeat(1024)).repeat(8192);
    fs::write(&path, &text).unwrap();
    let mut s = FileService::default(); s.set_owner("a");
    let opened = s.open_selected(path.clone(), None).unwrap(); let token = &opened.metadata.token;
    assert!(s.external_watcher.is_none());
    assert_eq!(s.check_external(token).unwrap(), opened.metadata.version);
    let local = format!("{text}local");
    let saved = s.save(token, &local, Some(&opened.metadata.version), "UTF-8", false).unwrap();
    assert_eq!(s.check_external(token).unwrap(), saved.version);
    fs::write(&path, &text).unwrap();
    assert_eq!(s.save(token, &local, Some(&saved.version), "UTF-8", false).unwrap_err().code, "conflict");
    assert_eq!(fs::read_to_string(&path).unwrap(), text);
}

#[test]
fn external_reads_keep_authority_and_expected_version_without_advancing_a_save() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("note.md");
    fs::write(&path, b"\xef\xbb\xbf# old\r\n").unwrap();
    let mut s = FileService::default(); s.set_owner("a");
    let opened = s.open_selected(path.clone(), None).unwrap();
    let token = &opened.metadata.token;
    fs::write(&path, b"\xef\xbb\xbf# new\r\nline\nlast\r").unwrap();
    let version = s.check_external(token).unwrap();
    assert_ne!(version, opened.metadata.version);
    assert_eq!(s.read_external(token,&opened.metadata.version,"UTF-8").unwrap_err().code,"conflict");
    let external = s.read_external(token,&version,"UTF-8").unwrap();
    assert_eq!(external.metadata.token,*token);
    assert!(external.metadata.bom); assert_eq!(external.metadata.eol,"Mixed");
    assert_eq!(external.text,"# new\r\nline\nlast\r");
    assert_eq!(s.grants.len(),1);
    assert_eq!(s.save(token,"local",Some(&opened.metadata.version),"UTF-8",true).unwrap_err().code,"conflict");
    assert!(fs::read(&path).unwrap().starts_with(b"\xef\xbb\xbf# new"));
    s.set_owner("b");
    assert_eq!(s.check_external(token).unwrap_err().code,"scope");
    assert_eq!(s.read_external(token,&version,"UTF-8").unwrap_err().code,"scope");
    assert_eq!(s.watch_external(vec![token.clone()],1,0).unwrap_err().code,"scope");
    s.set_owner("a"); s.release(token);
    assert_eq!(s.check_external(token).unwrap_err().code,"scope");
}

#[test]
fn external_delete_rename_atomic_replace_recreate_and_encoding_failure_preserve_grant() {
    let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("note.txt");
    fs::write(&path,"original").unwrap();
    let mut s = FileService::default(); s.set_owner("a");
    let opened = s.open_selected(path.clone(),None).unwrap(); let token=&opened.metadata.token;
    let moved = dir.path().join("renamed.txt"); fs::rename(&path,&moved).unwrap();
    assert_eq!(s.check_external(token).unwrap_err().code,"deleted");
    fs::write(&path,"new file").unwrap();
    let v=s.check_external(token).unwrap();
    assert_ne!(v,opened.metadata.version);
    assert_eq!(s.read_external(token,&v,"UTF-8").unwrap().text,"new file");
    let temp=dir.path().join("temp");fs::write(&temp,"atomic").unwrap();
    fs::remove_file(&path).unwrap();fs::rename(temp,&path).unwrap();
    let v=s.check_external(token).unwrap(); assert_eq!(s.read_external(token,&v,"UTF-8").unwrap().text,"atomic");
    fs::write(&path,[0xff,0xfe,0x80]).unwrap(); let v=s.check_external(token).unwrap();
    assert!(s.read_external(token,&v,"UTF-8").is_err());
    assert_eq!(s.grants.len(),1);
    assert!(s.prepare_target(path.clone(),Some(token)).is_err());
    assert_eq!(fs::read(moved).unwrap(),b"original");
}

#[test]
fn external_utf16_bom_hex_and_size_limits_are_preserved() {
    let dir=tempfile::tempdir().unwrap(); let path=dir.path().join("note.txt");
    let bytes=codec::encode("中文😀\r\nnext","UTF-16LE",true).unwrap();fs::write(&path,&bytes).unwrap();
    let mut s=FileService::default();s.set_owner("a");let opened=s.open_selected(path.clone(),None).unwrap();let token=&opened.metadata.token;
    let external=s.read_external(token,&opened.metadata.version,"UTF-16LE").unwrap();
    assert_eq!(external.text,"中文😀\r\nnext");assert_eq!(external.metadata.encoding,"UTF-16LE");assert!(external.metadata.bom);
    let hex=s.read_external(token,&opened.metadata.version,"Hex").unwrap();assert_eq!(hex.metadata.encoding,"Hex");
    assert!(!s.grants.get(token).unwrap().hex, "comparison cannot change writable byte semantics");
    assert_eq!(s.grants.get(token).unwrap().encoding.as_deref(), Some("UTF-16LE"));
    fs::File::options().write(true).open(&path).unwrap().set_len(MAX_BYTES+1).unwrap();
    assert_eq!(s.check_external(token).unwrap_err().code,"size");
}

#[test]
fn external_read_does_not_follow_a_replaced_file_link() {
    let dir=tempfile::tempdir().unwrap(); let path=dir.path().join("note.txt");let other=dir.path().join("other.txt");
    fs::write(&path,"original").unwrap();fs::write(&other,"private").unwrap();
    let mut s=FileService::default();s.set_owner("a");let opened=s.open_selected(path.clone(),None).unwrap();
    fs::remove_file(&path).unwrap();
    // Hard links require no Windows developer-mode privilege and must be refused.
    fs::hard_link(&other,&path).unwrap();
    assert!(s.check_external(&opened.metadata.token).is_err());
    assert!(s.read_external(&opened.metadata.token,&opened.metadata.version,"UTF-8").is_err());
    assert_eq!(fs::read(other).unwrap(),b"private");
}

#[cfg(windows)]
#[test]
fn external_exclusive_lock_keeps_buffer_authority_and_reports_unavailable() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("locked.txt");
    fs::write(&path, "original").unwrap();
    let mut s = FileService::default();
    s.set_owner("a");
    let opened = s.open_selected(path.clone(), None).unwrap();
    let lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&path)
        .unwrap();
    let error = s.check_external(&opened.metadata.token).unwrap_err();
    assert!(error.code == "io" || error.code == "permission");
    assert_eq!(s.grants.len(), 1);
    drop(lock);
    assert_eq!(fs::read(path).unwrap(), b"original");
}

#[test]
fn external_explicit_encodings_preserve_unicode_and_line_endings() {
    for (encoding, text) in [
        ("GB18030", "中文\r\n下一行"),
        ("UTF-16BE", "中文😀\nnext"),
        ("windows-1252", "café\rnext"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("encoded.txt");
        fs::write(&path, codec::encode(text, encoding, false).unwrap()).unwrap();
        let mut s = FileService::default();
        s.set_owner("a");
        let opened = s.open_selected(path, Some(encoding)).unwrap();
        let external = s
            .read_external(&opened.metadata.token, &opened.metadata.version, encoding)
            .unwrap();
        assert_eq!(external.text, text);
        assert_eq!(external.metadata.encoding, encoding);
        assert!(!external.metadata.bom);
    }
}

#[test]
fn stale_hmr_lease_cannot_unsubscribe_a_new_controller_or_cross_window_boundary() {
    let mut s = FileService::default();
    s.set_owner("a");
    let old = s.begin_external_watch();
    let current = s.begin_external_watch();
    s.end_external_watch(old);
    assert_eq!(s.external_leases.get("a"), Some(&current));
    assert_eq!(s.watch_external(vec![], 1, old).unwrap_err().code, "watch");
    s.set_owner("b");
    s.end_external_watch(current);
    assert_eq!(s.external_leases.get("a"), Some(&current));
    s.set_owner("a");
    s.end_external_watch(current);
    assert!(!s.external_leases.contains_key("a"));
}


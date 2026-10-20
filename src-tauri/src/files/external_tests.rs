use super::*;

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
    assert_eq!(s.watch_external(vec![token.clone()],1).unwrap_err().code,"scope");
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

use super::*;
use crate::files::FileService;
const PNG: &[u8] = include_bytes!("../../../tests/fixtures/assets/pixel.png");
fn fixture() -> (tempfile::TempDir, FileService, String) {
    let dir = tempfile::tempdir().unwrap();
    let doc = dir.path().join("中文 笔记.md");
    fs::write(&doc, b"# note").unwrap();
    let mut service = FileService::default();
    service.set_owner("main");
    let token = service.open_selected(doc, None).unwrap().metadata.token;
    (dir, service, token)
}
fn pixels(token: &str, directory: &str, name: &str) -> ImageImport {
    ImageImport {
        token: token.into(),
        source_token: None,
        bytes: Some(PNG.to_vec()),
        name: name.into(),
        directory: Some(directory.into()),
    }
}
#[test]
fn import_pixels_into_single_file_assets_and_never_overwrite() {
    let (dir, mut service, token) = fixture();
    for index in 0..3 {
        let result = service
            .import_image(pixels(&token, "./assets/", "中文 图片.png"))
            .unwrap();
        assert_eq!(
            result.name,
            if index == 0 {
                "中文 图片.png".into()
            } else {
                format!("中文 图片-{index}.png")
            }
        );
        assert_eq!(fs::read(&result.path).unwrap(), PNG);
        assert_eq!(
            service.markdown_image(&token, &result.path, &[]).unwrap(),
            PNG
        );
    }
    assert_eq!(
        service
            .markdown_image(&token, "./assets/中文 图片.png", &[])
            .unwrap(),
        PNG
    );
    assert_eq!(
        fs::read(dir.path().join("中文 笔记.md")).unwrap(),
        b"# note"
    );
}
#[test]
fn filename_variable_nested_directories_sibling_and_move_reopen() {
    let (dir, mut service, token) = fixture();
    let result = service
        .import_image(pixels(&token, "./${filename}.assets/nested/", "image.png"))
        .unwrap();
    assert!(result.path.contains("中文 笔记.assets"));
    let same = service
        .import_image(pixels(&token, ".", "sibling.png"))
        .unwrap();
    assert_eq!(fs::read(same.path).unwrap(), PNG);
    service.release(&token);
    let moved = dir.path().join("moved");
    fs::create_dir(&moved).unwrap();
    fs::rename(
        dir.path().join("中文 笔记.assets"),
        moved.join("中文 笔记.assets"),
    )
    .unwrap();
    fs::rename(dir.path().join("中文 笔记.md"), moved.join("note.md")).unwrap();
    let reopened = service.open_selected(moved.join("note.md"), None).unwrap();
    assert_eq!(
        service
            .markdown_image(
                &reopened.metadata.token,
                "./中文 笔记.assets/nested/image.png",
                &[]
            )
            .unwrap(),
        PNG
    );
}
#[test]
fn native_file_capability_copy_retain_and_cross_window_scope() {
    let (dir, mut service, token) = fixture();
    let original = dir.path().join("source.png");
    fs::write(&original, PNG).unwrap();
    let source = service.image_inputs(vec![original.clone()])[0]
        .token
        .clone();
    let input = |directory| ImageImport {
        token: token.clone(),
        source_token: Some(source.clone()),
        bytes: None,
        name: "ignored.png".into(),
        directory,
    };
    let copied = service
        .import_image(input(Some("./assets".into())))
        .unwrap();
    assert_ne!(PathBuf::from(copied.path), original);
    let kept = service.import_image(input(None)).unwrap();
    assert_eq!(fs::read(kept.path).unwrap(), PNG);
    service.set_owner("other");
    assert_eq!(
        service
            .import_image(input(Some(".".into())))
            .unwrap_err()
            .code,
        "scope"
    );
    service.set_owner("main");
    service.release_image_inputs(&[source.clone()]);
    assert!(service.import_image(input(None)).is_err());
}
#[test]
fn reject_invalid_formats_extensions_budgets_names_and_ungranted_documents() {
    let (dir, mut service, token) = fixture();
    for (name, bytes) in [
        ("bad.png", b"<svg/>".to_vec()),
        ("bad.gif", PNG.to_vec()),
        ("bad.png", vec![0; 4 * 1024 * 1024 + 1]),
        ("../evil.png", PNG.to_vec()),
        ("CON.png", PNG.to_vec()),
    ] {
        let mut input = pixels(&token, "./assets", name);
        input.bytes = Some(bytes);
        assert!(service.import_image(input).is_err());
    }
    let mut huge = PNG.to_vec();
    huge[16..20].copy_from_slice(&20000u32.to_be_bytes());
    let mut input = pixels(&token, "./assets", "huge.png");
    input.bytes = Some(huge);
    assert!(service.import_image(input).is_err());
    assert!(!dir.path().join("assets").exists());
    assert!(service
        .import_image(pixels("Untitled.md", "./assets", "image.png"))
        .is_err());
    let path = dir.path().join("text.txt");
    fs::write(&path, b"text").unwrap();
    let plain = service.open_selected(path, None).unwrap();
    assert!(service
        .import_image(pixels(&plain.metadata.token, "./assets", "image.png"))
        .is_err());
}
#[test]
fn traversal_requires_exact_native_directory_authorization() {
    let (dir, mut service, token) = fixture();
    let outside = tempfile::tempdir().unwrap();
    // A relative parent path cannot silently gain write permissions.
    let requested = "../lightedit-unapproved-assets";
    assert_eq!(
        service
            .import_image(pixels(&token, requested, "image.png"))
            .unwrap_err()
            .code,
        "image_directory_permission"
    );
    assert!(!dir
        .path()
        .parent()
        .unwrap()
        .join("lightedit-unapproved-assets")
        .exists());
    assert!(service
        .authorize_image_directory(&token, requested, outside.path())
        .is_err());
    for path in [
        "C:\\outside",
        "/outside",
        "\\\\server\\share",
        "assets/CON",
        "assets/x:ads",
        "assets\0x",
    ] {
        assert!(service
            .import_image(pixels(&token, path, "image.png"))
            .is_err());
    }
    let parent = dir.path().parent().unwrap();
    let shared = parent.join(outside.path().file_name().unwrap());
    let relative = format!("../{}", shared.file_name().unwrap().to_string_lossy());
    service
        .authorize_image_directory(&token, &relative, &shared)
        .unwrap();
    let result = service
        .import_image(pixels(&token, &relative, "authorized.png"))
        .unwrap();
    assert_eq!(fs::read(&result.path).unwrap(), PNG);
    service.release(&token);
    assert!(service
        .import_image(pixels(&token, &relative, "fail.png"))
        .is_err());
}

#[test]
fn external_image_read_authorization_is_exact_and_expires_with_document() {
    let (_dir, mut service, token) = fixture();
    let outside = tempfile::tempdir().unwrap();
    let image = outside.path().join("external.png");
    let other = outside.path().join("other.png");
    fs::write(&image, PNG).unwrap();
    fs::write(&other, PNG).unwrap();
    let path = image.to_string_lossy().into_owned();
    assert_eq!(
        service.markdown_image(&token, &path, &[]).unwrap_err().code,
        "image_scope"
    );
    assert!(service.authorize_image_read(&token, &path, &other).is_err());
    service.authorize_image_read(&token, &path, &image).unwrap();
    assert_eq!(service.markdown_image(&token, &path, &[]).unwrap(), PNG);
    service.release(&token);
    assert_eq!(
        service.markdown_image(&token, &path, &[]).unwrap_err().code,
        "scope"
    );
}
#[cfg(windows)]
#[test]
fn junction_escape_and_directory_lock_swap_are_rejected() {
    let (dir, mut service, token) = fixture();
    let outside = tempfile::tempdir().unwrap();
    let link = dir.path().join("linked");
    let output = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&link)
        .arg(outside.path())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(service
        .import_image(pixels(&token, "./linked", "escape.png"))
        .is_err());
    assert!(!outside.path().join("escape.png").exists());
    fs::remove_dir(&link).unwrap();
    let safe = dir.path().join("safe");
    fs::create_dir(&safe).unwrap();
    let locks = directory_locks(&safe).unwrap();
    assert!(fs::rename(&safe, dir.path().join("swapped")).is_err());
    drop(locks);
    assert!(fs::rename(&safe, dir.path().join("swapped")).is_ok());
}
#[cfg(windows)]
#[test]
fn read_only_attachment_directory_leaves_no_file_or_markdown_change() {
    let (dir, mut service, token) = fixture();
    let assets = dir.path().join("assets");
    fs::create_dir(&assets).unwrap();
    let denied = std::process::Command::new("icacls")
        .arg(&assets)
        .args(["/deny", "*S-1-1-0:(WD)"])
        .output()
        .unwrap();
    assert!(denied.status.success());
    let result = service.import_image(pixels(&token, "./assets", "denied.png"));
    let restored = std::process::Command::new("icacls")
        .arg(&assets)
        .args(["/remove:d", "*S-1-1-0"])
        .output()
        .unwrap();
    assert!(restored.status.success());
    assert!(result.is_err());
    assert_eq!(fs::read_dir(&assets).unwrap().count(), 0);
    assert_eq!(
        fs::read(dir.path().join("中文 笔记.md")).unwrap(),
        b"# note"
    );
}
#[cfg(unix)]
#[test]
fn unix_symlink_escape_is_rejected() {
    let (dir, mut service, token) = fixture();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), dir.path().join("linked")).unwrap();
    assert!(service
        .import_image(pixels(&token, "./linked", "escape.png"))
        .is_err());
    assert!(!outside.path().join("escape.png").exists());
}

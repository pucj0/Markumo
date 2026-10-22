use super::*;
use crate::history::HistoryStore;

fn fixture() -> (tempfile::TempDir, FileService, HistoryStore, PathBuf, OpenFile) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("document.md");
    fs::write(&path, "old\r\n正文").unwrap();
    let mut files = FileService::default();
    files.set_owner("window-a");
    let opened = files.open_selected(path.clone(), None).unwrap();
    let mut history = HistoryStore::default();
    history.configure(directory.path().join("history"));
    (directory, files, history, path, opened)
}

#[test]
fn history_save_persists_old_before_new_with_byte_exact_bodies() {
    let (_directory, mut files, history, path, opened) = fixture();
    let result = files.save_with_history(&opened.metadata.token, "new\r\n正文", Some(&opened.metadata.version), "UTF-8", false, &history).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "new\r\n正文");
    let entries = history.list(&display_path(&path)).unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(history.read(&display_path(&path), &entries[0].id).unwrap(), "new\r\n正文");
    assert_eq!(history.read(&display_path(&path), &entries[1].id).unwrap(), "old\r\n正文");
    assert_eq!(entries[0].origin, "saved");
    assert_eq!(entries[1].origin, "disk");
    assert_ne!(result.version, opened.metadata.version);
}

#[test]
fn history_save_refuses_to_overwrite_when_archive_cannot_be_persisted() {
    let (directory, mut files, mut history, path, opened) = fixture();
    let blocked = directory.path().join("not-a-directory");
    fs::write(&blocked, "blocked").unwrap();
    history.configure(blocked);
    let error = files.save_with_history(&opened.metadata.token, "new", Some(&opened.metadata.version), "UTF-8", false, &history).unwrap_err();
    assert_eq!(error.code, "history_backup");
    assert_eq!(fs::read_to_string(&path).unwrap(), "old\r\n正文");
}

#[test]
fn history_save_failed_write_never_records_an_unsaved_new_version() {
    let (_directory, mut files, history, path, opened) = fixture();
    #[cfg(windows)] super::atomic::fault::set(super::atomic::fault::TARGET_WRITE);
    #[cfg(not(windows))] super::atomic::fault::set(super::atomic::fault::REPLACE);
    let result = files.save_with_history(&opened.metadata.token, "new", Some(&opened.metadata.version), "UTF-8", false, &history);
    super::atomic::fault::clear();
    assert!(result.is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), "old\r\n正文");
    let entries = history.list(&display_path(&path)).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].origin, "disk");
}

#[test]
fn history_save_uses_original_explicit_encoding_before_conversion() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("western.txt");
    fs::write(&path, codec::encode("café", "windows-1252", false).unwrap()).unwrap();
    let mut files = FileService::default(); files.set_owner("window-a");
    let opened = files.open_selected(path.clone(), Some("windows-1252")).unwrap();
    let mut history = HistoryStore::default(); history.configure(directory.path().join("history"));
    files.save_with_history(&opened.metadata.token, "new UTF-8", Some(&opened.metadata.version), "UTF-8", false, &history).unwrap();
    let entries = history.list(&display_path(&path)).unwrap();
    assert_eq!(history.read(&display_path(&path), &entries[1].id).unwrap(), "café");
}

#[test]
fn history_save_serializes_two_window_writers_and_rejects_the_stale_version() {
    use std::sync::{Arc, Mutex};
    let (_directory, mut files, history, path, opened) = fixture();
    files.set_owner("window-b");
    let second = files.open_selected(path.clone(), None).unwrap();
    let files = Arc::new(Mutex::new(files));
    let history = Arc::new(history);
    let handles: Vec<_> = [("window-a", opened, "body A"), ("window-b", second, "body B")].into_iter().map(|(owner, opened, body)| {
        let files = files.clone(); let history = history.clone();
        std::thread::spawn(move || {
            let mut files = files.lock().unwrap(); files.set_owner(owner);
            files.save_with_history(&opened.metadata.token, body, Some(&opened.metadata.version), "UTF-8", false, &history)
        })
    }).collect();
    let results: Vec<_> = handles.into_iter().map(|handle| handle.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(results.iter().filter_map(|result| result.as_ref().err()).next().unwrap().code, "conflict");
    let entries = history.list(&display_path(&path)).unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(history.read(&display_path(&path), &entries[0].id).unwrap(), fs::read_to_string(&path).unwrap());
    assert_eq!(entries[1].origin, "disk");
}

//! A single native watcher, shared parent-directory subscriptions, and a bounded
//! hint queue. Hints never authorize a path or stand in for a verified read.
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{collections::{HashMap, HashSet}, path::PathBuf, sync::{mpsc, Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::{Duration, Instant}};
use tauri::{AppHandle, Emitter};
use super::{FileError, Result};

#[derive(Clone, Serialize)]
pub struct Hint { pub generation: u64, pub tokens: Vec<String>, pub error: Option<String> }
#[derive(Default)]
struct Targets { owners: HashMap<String, (u64, HashMap<String, PathBuf>)> }
#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct WatchStatus { pub watcher_count: usize, pub directory_count: usize, pub file_count: usize }

// Both normal and deadline-boundary events obey the same filtering and budget.
// In particular, a late access event must not start another hash/read cycle.
fn collect_event(event: notify::Result<notify::Event>, paths: &mut HashSet<PathBuf>, error: &mut Option<String>) -> bool {
    match event {
        Ok(event) if !matches!(event.kind, notify::EventKind::Access(_)) => {
            let mut overflow = false;
            for path in event.paths {
                if paths.len() < 4096 || paths.contains(&path) { paths.insert(path); }
                else { overflow = true; }
            }
            overflow
        }
        Ok(_) => false,
        Err(e) => { *error = Some(format!("实时监测发生错误，已改用窗口焦点检查：{e}")); false }
    }
}

pub struct ExternalWatcher {
    watcher: Option<RecommendedWatcher>,
    targets: Arc<Mutex<Targets>>,
    directories: HashSet<PathBuf>,
    worker: Option<std::thread::JoinHandle<()>>,
}
impl ExternalWatcher {
    pub fn new(app: AppHandle) -> Result<Self> {
        Self::with_sink(move |owner, hint| { let _ = app.emit_to(owner, "external-file-change", hint); })
    }
    fn with_sink(sink: impl Fn(&str, Hint) + Send + 'static) -> Result<Self> {
        let targets = Arc::new(Mutex::new(Targets::default()));
        let observed = targets.clone();
        let (tx, rx) = mpsc::sync_channel(256);
        let overflow = Arc::new(AtomicBool::new(false));
        let full = overflow.clone();
        let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            // Do not let read-only activity fill the bounded channel and turn
            // its overflow fallback into another full-document check cycle.
            if event.as_ref().is_ok_and(|event| matches!(event.kind, notify::EventKind::Access(_))) { return; }
            if tx.try_send(event).is_err() { full.store(true, Ordering::Release); }
        }).map_err(|e| FileError::new("watch", &e.to_string()))?;
        let worker = std::thread::spawn(move || {
            while let Ok(first) = rx.recv() {
                let mut paths = HashSet::new();
                let mut error = None;
                let deadline = Instant::now() + Duration::from_millis(180);
                let mut next = Some(first);
                loop {
                    if let Some(event) = next.take() {
                        if collect_event(event, &mut paths, &mut error) { overflow.store(true, Ordering::Release); }
                    }
                    match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                        Ok(event) if Instant::now() < deadline => next = Some(event),
                        Ok(event) => { // Preserve the boundary event rather than dropping it.
                            if collect_event(event, &mut paths, &mut error) { overflow.store(true, Ordering::Release); }
                            break;
                        }
                        Err(_) => break,
                    }
                }
                let all = overflow.swap(false, Ordering::AcqRel) || error.is_some();
                let deliveries: Vec<_> = observed.lock().unwrap().owners.iter().map(|(owner,(generation, files))| {
                    let tokens = files.iter().filter(|(_,p)| all || paths.iter().any(|changed| changed == *p || p.starts_with(changed)))
                        .map(|(token,_)| token.clone()).collect::<Vec<_>>();
                    (owner.clone(), Hint { generation: *generation, tokens, error: error.clone() })
                }).collect();
                for (owner, hint) in deliveries { if !hint.tokens.is_empty() || hint.error.is_some() { sink(&owner, hint); } }
            }
        });
        Ok(Self { watcher: Some(watcher), targets, directories: HashSet::new(), worker: Some(worker) })
    }
    pub fn set(&mut self, owner: &str, generation: u64, files: HashMap<String, PathBuf>) -> Result<WatchStatus> {
        self.targets.lock().unwrap().owners.insert(owner.into(), (generation, files));
        self.reconcile()?;
        let targets = self.targets.lock().unwrap();
        Ok(WatchStatus { watcher_count: usize::from(!self.directories.is_empty()), directory_count: self.directories.len(), file_count: targets.owners.values().map(|(_,f)|f.len()).sum() })
    }
    pub fn release(&mut self, owner: &str, token: Option<&str>) {
        {
            let mut targets = self.targets.lock().unwrap();
            if let Some(token) = token { if let Some((_,files)) = targets.owners.get_mut(owner) { files.remove(token); } }
            else { targets.owners.remove(owner); }
        }
        let _ = self.reconcile();
    }
    fn reconcile(&mut self) -> Result<()> {
        let wanted: HashSet<_> = self.targets.lock().unwrap().owners.values().flat_map(|(_,f)| f.values()).filter_map(|p|p.parent().map(PathBuf::from)).collect();
        let watcher = self.watcher.as_mut().unwrap();
        for path in self.directories.difference(&wanted) { let _ = watcher.unwatch(path); }
        self.directories.retain(|p|wanted.contains(p));
        for path in wanted.difference(&self.directories).cloned().collect::<Vec<_>>() {
            watcher.watch(&path, RecursiveMode::NonRecursive).map_err(|e| FileError::new("watch", &format!("实时监测不可用，将在窗口获得焦点时检查：{e}")))?;
            self.directories.insert(path);
        }
        Ok(())
    }
}
impl Drop for ExternalWatcher {
    fn drop(&mut self) { self.watcher.take(); if let Some(worker) = self.worker.take() { let _ = worker.join(); } }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn watch_limit_releases_old_owner_resources_without_revoking_other_windows_or_newer_leases() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.txt");
        std::fs::write(&path, "body").unwrap();
        let mut service = crate::files::FileService::default();
        service.external_watcher = Some(ExternalWatcher::with_sink(|_, _| {}).unwrap());
        service.set_owner("first");
        let first = service.open_selected(path.clone(), None).unwrap().metadata.token;
        let stale = service.begin_external_watch();
        let current = service.begin_external_watch();
        service.watch_external(vec![first.clone()], 1, current).unwrap();
        service.set_owner("second");
        let second = service.open_selected(path, None).unwrap().metadata.token;
        let second_lease = service.begin_external_watch();
        service.watch_external(vec![second], 1, second_lease).unwrap();
        service.set_owner("first");
        assert!(service.watch_external(vec![first.clone(); 1025], 2, stale).is_err());
        assert_eq!(service.external_watcher.as_ref().unwrap().targets.lock().unwrap().owners.len(), 2);
        assert!(service.watch_external(vec![first; 1025], 3, current).is_err());
        let watcher = service.external_watcher.as_ref().unwrap();
        let targets = watcher.targets.lock().unwrap();
        assert!(!targets.owners.contains_key("first"), "limit fallback retained stale owner subscriptions");
        assert!(targets.owners.contains_key("second"));
        assert_eq!(watcher.directories.len(), 1);
    }
    #[test]
    fn own_native_save_hints_reach_both_windows_with_shared_directory_and_new_baseline() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("note.md");
        std::fs::write(&path, "old").unwrap();
        let mut service = crate::files::FileService::default(); service.set_owner("first");
        let opened = service.open_selected(path, None).unwrap();
        let path = PathBuf::from(&opened.metadata.path); let token = opened.metadata.token;
        let (tx, rx) = mpsc::channel();
        let mut watcher = ExternalWatcher::with_sink(move |owner, hint| { let _ = tx.send((owner.to_owned(), hint)); }).unwrap();
        watcher.set("first", 1, HashMap::from([(token.clone(), path.clone())])).unwrap();
        let status = watcher.set("second", 2, HashMap::from([("other-window-token".into(), path)])).unwrap();
        assert_eq!(status.directory_count, 1); assert_eq!(status.file_count, 2);
        let saved = service.save(&token, "# own save", Some(&opened.metadata.version), "UTF-8", false).unwrap();
        let mut owners = HashSet::new();
        while owners.len() < 2 {
            let (owner, hint) = rx.recv_timeout(Duration::from_secs(5)).unwrap();
            if owner == "first" { assert_eq!(hint.generation, 1); assert!(hint.tokens.contains(&token)); }
            else { assert_eq!(hint.generation, 2); assert!(hint.tokens.contains(&"other-window-token".into())); }
            owners.insert(owner);
        }
        assert_eq!(service.check_external(&token).unwrap(), saved.version);
        watcher.release("first", None); assert_eq!(watcher.directories.len(), 1);
        watcher.release("second", None); assert!(watcher.directories.is_empty());
    }
    #[test]
    fn duplicate_hints_access_events_and_deadline_errors_share_one_bounded_batch() {
        let mut paths = HashSet::new(); let mut error = None;
        for _ in 0..100 {
            assert!(!collect_event(Ok(notify::Event::new(notify::EventKind::Modify(notify::event::ModifyKind::Any)).add_path("note.txt".into())), &mut paths, &mut error));
        }
        assert_eq!(paths.len(), 1);
        assert!(!collect_event(Ok(notify::Event::new(notify::EventKind::Access(notify::event::AccessKind::Any)).add_path("access-only.txt".into())), &mut paths, &mut error));
        assert_eq!(paths.len(), 1);
        assert!(!collect_event(Err(notify::Error::generic("boundary failure")), &mut paths, &mut error));
        assert!(error.unwrap().contains("boundary failure"));
        let mut error = None;
        for n in 0..4095 { collect_event(Ok(notify::Event::new(notify::EventKind::Any).add_path(format!("file-{n}").into())), &mut paths, &mut error); }
        assert!(collect_event(Ok(notify::Event::new(notify::EventKind::Any).add_path("overflow".into())), &mut paths, &mut error));
        assert_eq!(paths.len(), 4096);
    }
    #[test]
    fn native_parent_watcher_detects_atomic_replacement_and_releases_resources() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.txt");
        std::fs::write(&path,b"a").unwrap();
        let path = path.canonicalize().unwrap();
        let (tx,rx) = mpsc::channel();
        let mut watcher = ExternalWatcher::with_sink(move |owner,hint| { tx.send((owner.to_owned(),hint)).unwrap(); }).unwrap();
        let status = watcher.set("first",7,HashMap::from([("one".into(),path.clone()),("two".into(),dir.path().canonicalize().unwrap().join("other.txt"))])).unwrap();
        assert_eq!(status.directory_count,1);
        assert_eq!(status.file_count,2);
        let temp = dir.path().join("temp.txt");
        std::fs::write(&temp,b"b").unwrap();
        std::fs::remove_file(&path).unwrap();
        std::fs::rename(temp,&path).unwrap();
        let (owner,hint) = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(owner,"first"); assert_eq!(hint.generation,7); assert!(hint.tokens.contains(&"one".into()));
        watcher.release("first",None);
        assert!(watcher.directories.is_empty());
        assert!(watcher.targets.lock().unwrap().owners.is_empty());
    }
}

//! A single native watcher, shared parent-directory subscriptions, and a bounded
//! hint queue. Hints never authorize a path or stand in for a verified read.
use super::{FileError, Result};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
pub struct Hint {
    pub generation: u64,
    pub tokens: Vec<String>,
    pub error: Option<String>,
}
#[derive(Default)]
struct Targets {
    owners: HashMap<String, (u64, HashMap<String, PathBuf>)>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchStatus {
    pub watcher_count: usize,
    pub directory_count: usize,
    pub file_count: usize,
}

pub struct ExternalWatcher {
    watcher: Option<RecommendedWatcher>,
    targets: Arc<Mutex<Targets>>,
    directories: HashSet<PathBuf>,
    worker: Option<std::thread::JoinHandle<()>>,
}
impl ExternalWatcher {
    pub fn new(app: AppHandle) -> Result<Self> {
        Self::with_sink(move |owner, hint| {
            let _ = app.emit_to(owner, "external-file-change", hint);
        })
    }
    fn with_sink(sink: impl Fn(&str, Hint) + Send + 'static) -> Result<Self> {
        let targets = Arc::new(Mutex::new(Targets::default()));
        let observed = targets.clone();
        let (tx, rx) = mpsc::sync_channel(256);
        let overflow = Arc::new(AtomicBool::new(false));
        let full = overflow.clone();
        let watcher = notify::recommended_watcher(move |event| {
            if tx.try_send(event).is_err() {
                full.store(true, Ordering::Release);
            }
        })
        .map_err(|e| FileError::new("watch", &e.to_string()))?;
        let worker = std::thread::spawn(move || {
            while let Ok(first) = rx.recv() {
                let mut paths = HashSet::new();
                let mut error = None;
                let deadline = Instant::now() + Duration::from_millis(180);
                let mut next = Some(first);
                loop {
                    if let Some(event) = next.take() {
                        match event {
                            Ok(event) => {
                                // Reads must not generate a new check/read feedback loop.
                                if !matches!(event.kind, notify::EventKind::Access(_)) {
                                    for path in event.paths {
                                        if paths.len() < 4096 {
                                            paths.insert(path);
                                        } else {
                                            overflow.store(true, Ordering::Release);
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                error = Some(format!("实时监测发生错误，已改用窗口焦点检查：{e}"))
                            }
                        }
                    }
                    match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                        Ok(event) if Instant::now() < deadline => next = Some(event),
                        Ok(event) => {
                            // Preserve the boundary event rather than dropping it.
                            if let Ok(event) = event {
                                paths.extend(event.paths.into_iter().take(4096));
                            }
                            break;
                        }
                        Err(_) => break,
                    }
                }
                let all = overflow.swap(false, Ordering::AcqRel) || error.is_some();
                let deliveries: Vec<_> = observed
                    .lock()
                    .unwrap()
                    .owners
                    .iter()
                    .map(|(owner, (generation, files))| {
                        let tokens = files
                            .iter()
                            .filter(|(_, p)| {
                                all || paths
                                    .iter()
                                    .any(|changed| changed == *p || p.starts_with(changed))
                            })
                            .map(|(token, _)| token.clone())
                            .collect::<Vec<_>>();
                        (
                            owner.clone(),
                            Hint {
                                generation: *generation,
                                tokens,
                                error: error.clone(),
                            },
                        )
                    })
                    .collect();
                for (owner, hint) in deliveries {
                    if !hint.tokens.is_empty() || hint.error.is_some() {
                        sink(&owner, hint);
                    }
                }
            }
        });
        Ok(Self {
            watcher: Some(watcher),
            targets,
            directories: HashSet::new(),
            worker: Some(worker),
        })
    }
    pub fn set(
        &mut self,
        owner: &str,
        generation: u64,
        files: HashMap<String, PathBuf>,
    ) -> Result<WatchStatus> {
        self.targets
            .lock()
            .unwrap()
            .owners
            .insert(owner.into(), (generation, files));
        self.reconcile()?;
        let targets = self.targets.lock().unwrap();
        Ok(WatchStatus {
            watcher_count: 1,
            directory_count: self.directories.len(),
            file_count: targets.owners.values().map(|(_, f)| f.len()).sum(),
        })
    }
    pub fn release(&mut self, owner: &str, token: Option<&str>) {
        {
            let mut targets = self.targets.lock().unwrap();
            if let Some(token) = token {
                if let Some((_, files)) = targets.owners.get_mut(owner) {
                    files.remove(token);
                }
            } else {
                targets.owners.remove(owner);
            }
        }
        let _ = self.reconcile();
    }
    fn reconcile(&mut self) -> Result<()> {
        let wanted: HashSet<_> = self
            .targets
            .lock()
            .unwrap()
            .owners
            .values()
            .flat_map(|(_, f)| f.values())
            .filter_map(|p| p.parent().map(PathBuf::from))
            .collect();
        let watcher = self.watcher.as_mut().unwrap();
        for path in self.directories.difference(&wanted) {
            let _ = watcher.unwatch(path);
        }
        self.directories.retain(|p| wanted.contains(p));
        let mut failure = None;
        for path in wanted
            .difference(&self.directories)
            .cloned()
            .collect::<Vec<_>>()
        {
            match watcher.watch(&path, RecursiveMode::NonRecursive) {
                Ok(()) => {
                    self.directories.insert(path);
                }
                Err(e) => {
                    failure = Some(FileError::new(
                        "watch",
                        &format!("部分文件的实时监测不可用，将在窗口获得焦点时检查：{e}"),
                    ))
                }
            }
        }
        if let Some(error) = failure {
            Err(error)
        } else {
            Ok(())
        }
    }
}
impl Drop for ExternalWatcher {
    fn drop(&mut self) {
        self.watcher.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_parent_watcher_detects_atomic_replacement_and_releases_resources() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.txt");
        std::fs::write(&path, b"a").unwrap();
        let path = path.canonicalize().unwrap();
        let (tx, rx) = mpsc::channel();
        let mut watcher = ExternalWatcher::with_sink(move |owner, hint| {
            tx.send((owner.to_owned(), hint)).unwrap();
        })
        .unwrap();
        let status = watcher
            .set(
                "first",
                7,
                HashMap::from([
                    ("one".into(), path.clone()),
                    (
                        "two".into(),
                        dir.path().canonicalize().unwrap().join("other.txt"),
                    ),
                ]),
            )
            .unwrap();
        assert_eq!(status.directory_count, 1);
        assert_eq!(status.file_count, 2);
        let temp = dir.path().join("temp.txt");
        std::fs::write(&temp, b"b").unwrap();
        std::fs::remove_file(&path).unwrap();
        std::fs::rename(temp, &path).unwrap();
        let (owner, hint) = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(owner, "first");
        assert_eq!(hint.generation, 7);
        assert!(hint.tokens.contains(&"one".into()));
        watcher.release("first", None);
        assert!(watcher.directories.is_empty());
        assert!(watcher.targets.lock().unwrap().owners.is_empty());
    }
}

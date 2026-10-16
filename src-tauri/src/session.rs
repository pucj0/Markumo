use crate::files::{FileService, Layout};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
};

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LaunchKind {
    App,
    File,
}
#[derive(Clone)]
pub struct WindowLaunch {
    pub kind: LaunchKind,
    pub paths: Vec<PathBuf>,
    pub pending: Vec<PathBuf>,
}
#[derive(Default)]
pub struct LaunchRegistry {
    pub windows: HashMap<String, WindowLaunch>,
    /// Insertion order so "the most recent single-file window" is well defined.
    pub order: Vec<String>,
    pub next: u64,
}
impl LaunchRegistry {
    pub fn insert(&mut self, label: String, paths: Vec<PathBuf>) {
        let kind = if paths.is_empty() {
            LaunchKind::App
        } else {
            LaunchKind::File
        };
        if !self.windows.contains_key(&label) {
            self.order.push(label.clone());
        }
        self.windows.insert(
            label,
            WindowLaunch {
                kind,
                paths,
                pending: Vec::new(),
            },
        );
    }
    pub fn owner(&self) -> Option<String> {
        self.windows
            .iter()
            .find(|(_, w)| w.kind == LaunchKind::App)
            .map(|(label, _)| label.clone())
    }
    pub fn window_for(&self, key: &PathKey) -> Option<String> {
        self.windows
            .iter()
            .find(|(_, window)| {
                window
                    .paths
                    .iter()
                    .chain(window.pending.iter())
                    .any(|path| &PathKey::of(path) == key)
            })
            .map(|(label, _)| label.clone())
    }
    /// Most recently created single-file window, reused for further external
    /// opens instead of spawning one window per double-click.
    pub fn latest_file_window(&self) -> Option<String> {
        self.order
            .iter()
            .rev()
            .find(|label| self.windows.get(*label).is_some_and(|window| window.kind == LaunchKind::File))
            .cloned()
    }
    /// Newest window of any kind, used when no application window exists.
    pub fn latest_window(&self) -> Option<String> {
        self.order
            .iter()
            .rev()
            .find(|label| self.windows.contains_key(*label))
            .cloned()
    }
    pub fn remove(&mut self, label: &str) {
        self.windows.remove(label);
        self.order.retain(|entry| entry != label);
    }
    pub fn next_label(&mut self, kind: LaunchKind) -> String {
        self.next += 1;
        format!(
            "{}-{}",
            if kind == LaunchKind::File { "file" } else { "app" },
            self.next
        )
    }
}
pub type LaunchStore = Mutex<LaunchRegistry>;

/// Maximum number of concurrent Markumo windows.
pub const MAX_WINDOWS: usize = 16;

/// What the caller must do for one external open request.
#[derive(Debug, Default, PartialEq)]
pub struct RoutePlan {
    /// Windows to bring to the front and let their frontend drain the queue.
    pub deliveries: Vec<String>,
    /// Files that are already open in that window. The frontend selects the
    /// existing tab instead of reloading the file or creating another tab.
    pub activate: Vec<(String, Vec<PathBuf>)>,
    /// A new single-file window to build, with its initial files.
    pub created: Option<(String, Vec<PathBuf>)>,
}

/// Pure routing decision for external file requests.
///
/// * `owners[i]` is the window that already has `requested[i]` open (from the
///   file service grants), or `None`.
/// * `window_exists` filters out owners whose window has already been destroyed.
///
/// The whole decision happens while the caller holds the launch lock, so two
/// rapid double-clicks of the same file cannot both decide to create a window.
pub fn plan_external_open(
    registry: &mut LaunchRegistry,
    requested: &[PathBuf],
    owners: &[Option<String>],
    window_exists: &dyn Fn(&str) -> bool,
) -> RoutePlan {
    let mut plan = RoutePlan::default();
    let mut unowned: Vec<PathBuf> = Vec::new();
    for (index, path) in requested.iter().enumerate() {
        let key = PathKey::of(path);
        let owner = owners
            .get(index)
            .cloned()
            .flatten()
            .filter(|label| window_exists(label));
        if let Some(label) = owner {
            // Already open there: activate the tab and never reload the file over
            // unsaved edits, and never queue a duplicate tab.
            match plan.activate.iter_mut().find(|(existing, _)| *existing == label) {
                Some((_, list)) => list.push(path.clone()),
                None => plan.activate.push((label.clone(), vec![path.clone()])),
            }
            if !plan.deliveries.contains(&label) {
                plan.deliveries.push(label);
            }
            continue;
        }
        // A file already queued for a window stays with that window.
        match registry.window_for(&key) {
            Some(label) => {
                if !plan.deliveries.contains(&label) {
                    plan.deliveries.push(label);
                }
            }
            None => unowned.push(path.clone()),
        }
    }
    if !unowned.is_empty() {
        if let Some(label) = registry.latest_file_window() {
            // Reuse the existing single-file window instead of spawning another.
            if let Some(window) = registry.windows.get_mut(&label) {
                for path in &unowned {
                    let key = PathKey::of(path);
                    if !window_knows(window, &key) {
                        window.pending.push(path.clone());
                    }
                }
            }
            if !plan.deliveries.contains(&label) {
                plan.deliveries.push(label);
            }
        } else if registry.windows.len() < MAX_WINDOWS {
            // No single-file window: reserve one now, so a concurrent request for
            // the same file joins this window instead of creating a second one.
            let label = registry.next_label(LaunchKind::File);
            registry.insert(label.clone(), unowned.clone());
            plan.created = Some((label, unowned));
        }
    }
    plan
}

fn window_knows(window: &WindowLaunch, key: &PathKey) -> bool {
    window
        .paths
        .iter()
        .chain(window.pending.iter())
        .any(|path| &PathKey::of(path) == key)
}

/// Comparison key for one file. NTFS is case-insensitive, and the shell may hand
/// us either case or a different alias of the same file, so identity is compared
/// on the canonical path with a case-folded key. Never used for I/O.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct PathKey(String);
impl PathKey {
    pub fn of(path: &Path) -> Self {
        let text = path.to_string_lossy();
        if cfg!(windows) {
            PathKey(text.to_lowercase())
        } else {
            PathKey(text.into_owned())
        }
    }
}

/// Canonical, validated, de-duplicated external open requests.
///
/// Every path goes through the same native check as a user-selected file, so
/// aliases collapse to one entry: relative vs absolute, mixed case, `\\?\`
/// verbatim prefixes, junctions and short names all resolve through
/// `canonicalize`. Paths that are not readable regular files are dropped here
/// (the caller reports the failure through the normal open batch).
pub fn normalize_external_paths(paths: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
    let mut seen: HashSet<PathKey> = HashSet::new();
    let mut unique = Vec::new();
    for path in paths.into_iter().take(100) {
        let Ok(canonical) = crate::files::checked_path(&path, false) else {
            continue;
        };
        if seen.insert(PathKey::of(&canonical)) {
            unique.push(canonical);
        }
    }
    unique
}

pub fn argument_paths(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<PathBuf> {
    let mut literal = false;
    args.into_iter()
        .skip(1)
        .filter_map(|arg| {
            if arg == "--" && !literal {
                literal = true;
                return None;
            }
            if !literal && arg.starts_with('-') {
                return None;
            }
            let path = PathBuf::from(arg);
            Some(if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            })
        })
        .take(100)
        .collect()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionTab {
    pub path: String,
    pub encoding: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LastSession {
    pub schema_version: u8,
    pub kind: String,
    pub roots: Vec<String>,
    pub tabs: Vec<SessionTab>,
    pub active_path: Option<String>,
    pub layout: Layout,
}
impl LastSession {
    fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1
            || !["single", "workspace"].contains(&self.kind.as_str())
            || self.tabs.len() > 100
            || self.roots.len() > 16
            || !(190..=420).contains(&self.layout.sidebar_width)
            || !["single", "workspace"].contains(&self.layout.mode.as_str())
        {
            return Err("会话版本或布局参数无效".into());
        }
        if self.kind == "single" && !self.roots.is_empty() {
            return Err("单文件会话不能包含工作区根目录".into());
        }
        for path in self
            .roots
            .iter()
            .chain(self.tabs.iter().map(|tab| &tab.path))
        {
            let p = Path::new(path);
            if path.len() > 16384
                || !p.is_absolute()
                || p.components()
                    .any(|c| matches!(c, std::path::Component::ParentDir))
            {
                return Err("会话包含无效路径".into());
            }
        }
        if self.tabs.iter().any(|t| {
            ![
                "UTF-8",
                "UTF-16LE",
                "UTF-16BE",
                "GB18030",
                "windows-1252",
                "Hex",
                "ClassInfo",
            ]
            .contains(&t.encoding.as_str())
        }) {
            return Err("会话编码无效".into());
        }
        let mut unique = std::collections::HashSet::new();
        if self.tabs.iter().any(|t| !unique.insert(&t.path))
            || self
                .active_path
                .as_ref()
                .is_some_and(|p| !unique.contains(p))
        {
            return Err("会话标签或活动标签无效".into());
        }
        Ok(())
    }
}
#[derive(Default)]
pub struct SessionService {
    path: Option<PathBuf>,
}
impl SessionService {
    pub fn configure(&mut self, path: PathBuf) {
        self.path = Some(path)
    }
    pub fn load(&self) -> Result<Option<LastSession>, String> {
        let path = self.path.as_ref().ok_or("会话存储尚未初始化")?;
        let file = match std::fs::File::open(path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.to_string()),
        };
        let mut bytes = Vec::new();
        file.take(512 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 512 * 1024 {
            return Err("会话文件过大，已跳过恢复".into());
        }
        let session: LastSession =
            serde_json::from_slice(&bytes).map_err(|e| format!("上次会话损坏，已跳过恢复：{e}"))?;
        session.validate()?;
        Ok(Some(session))
    }
    pub fn save(&self, session: &LastSession) -> Result<(), String> {
        session.validate()?;
        let path = self.path.as_ref().ok_or("会话存储尚未初始化")?;
        let parent = path.parent().ok_or("无效会话目录")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let bytes = serde_json::to_vec_pretty(session).map_err(|e| e.to_string())?;
        if bytes.len() > 512 * 1024 {
            return Err("会话过大，旧会话仍保留".into());
        }
        let version = crate::files::disk_version(path).map_err(|e| e.message)?;
        let canonical = crate::files::checked_path(path, true).map_err(|e| e.message)?;
        crate::files::atomic::write_checked(&canonical, &bytes, version.as_deref())
            .map_err(|e| e.message)
    }
}
pub type SessionStore = Mutex<SessionService>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionTabInput {
    pub token: String,
    pub encoding: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionInput {
    pub kind: String,
    pub tabs: Vec<SessionTabInput>,
    pub active_token: Option<String>,
    pub layout: Layout,
}
pub fn capture(
    input: SessionInput,
    files: &FileService,
    roots: Vec<PathBuf>,
) -> Result<LastSession, String> {
    if input.tabs.len() > 100 {
        return Err("会话最多记录100个标签".into());
    }
    let tabs = input
        .tabs
        .into_iter()
        .map(|tab| {
            Ok(SessionTab {
                path: files
                    .session_path(&tab.token)
                    .map_err(|e| e.message)?
                    .to_string_lossy()
                    .into_owned(),
                encoding: tab.encoding,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let active_path = input
        .active_token
        .map(|token| {
            files
                .session_path(&token)
                .map(|p| p.to_string_lossy().into_owned())
                .map_err(|e| e.message)
        })
        .transpose()?;
    let session = LastSession {
        schema_version: 1,
        kind: input.kind.clone(),
        roots: if input.kind == "workspace" {
            roots
                .into_iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect()
        } else {
            Vec::new()
        },
        tabs,
        active_path,
        layout: input.layout,
    };
    session.validate()?;
    Ok(session)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn arguments_distinguish_no_files_multiple_files_and_literal_dash() {
        let cwd = std::env::current_dir().unwrap();
        assert!(argument_paths(vec!["app".into(), "--flag".into()], &cwd).is_empty());
        assert_eq!(
            argument_paths(vec!["app".into(), "a b.txt".into(), "中文.md".into()], &cwd),
            vec![cwd.join("a b.txt"), cwd.join("中文.md")]
        );
        assert_eq!(
            argument_paths(vec!["app".into(), "--".into(), "-a.txt".into()], &cwd),
            vec![cwd.join("-a.txt")]
        );
    }
    #[test]
    fn session_is_separate_from_recents_and_validates_schema_and_tokens() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.txt");
        std::fs::write(&path, "keep").unwrap();
        let mut files = FileService::default();
        let file = files.open_selected(path, None).unwrap();
        let input = SessionInput {
            kind: "single".into(),
            tabs: vec![SessionTabInput {
                token: file.metadata.token.clone(),
                encoding: "UTF-8".into(),
            }],
            active_token: Some(file.metadata.token),
            layout: Layout::default(),
        };
        let session = capture(input, &files, Vec::new()).unwrap();
        let mut store = SessionService::default();
        store.configure(dir.path().join("last-session.json"));
        assert!(store.load().unwrap().is_none());
        store.save(&session).unwrap();
        files.preferences.recent.clear();
        assert_eq!(store.load().unwrap().unwrap().tabs.len(), 1);
        let mut invalid = session.clone();
        invalid.schema_version = 2;
        assert!(store.save(&invalid).is_err());
        assert_eq!(store.load().unwrap().unwrap().schema_version, 1);
        std::fs::write(dir.path().join("last-session.json"), "broken").unwrap();
        assert!(store.load().is_err());
    }
    #[test]
    fn file_launch_cannot_own_last_session() {
        let mut r = LaunchRegistry::default();
        r.insert("main".into(), vec![PathBuf::from("external.txt")]);
        assert!(r.owner().is_none());
        r.insert("app-1".into(), Vec::new());
        r.insert("file-2".into(), vec![PathBuf::from("other.txt")]);
        assert_eq!(r.owner().as_deref(), Some("app-1"));
    }

    fn always(_: &str) -> bool {
        true
    }
    fn paths(names: &[&str]) -> Vec<PathBuf> {
        names.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn external_open_of_an_already_open_file_activates_its_window_without_a_new_tab() {
        let mut r = LaunchRegistry::default();
        r.insert("main".into(), Vec::new()); // workspace window owns nothing yet
        r.insert("file-1".into(), paths(&[r"C:\docs\a.txt"]));
        // The file is open in the workspace window.
        let plan = plan_external_open(&mut r, &paths(&[r"C:\docs\a.txt"]), &[Some("main".into())], &always);
        assert_eq!(plan.deliveries, vec!["main".to_string()]);
        assert_eq!(plan.activate, vec![("main".to_string(), paths(&[r"C:\docs\a.txt"]))]);
        assert!(plan.created.is_none(), "已打开文件不得新建窗口");
        // Nothing was queued anywhere: the existing tab is merely activated and
        // the file is not read from disk again.
        for label in ["main", "file-1"] {
            assert!(r.windows[label].pending.is_empty(), "{label} 不应出现重复标签");
        }
    }

    #[test]
    fn external_open_skips_a_destroyed_owner_window() {
        let mut r = LaunchRegistry::default();
        r.insert("main".into(), Vec::new());
        let plan = plan_external_open(&mut r, &paths(&[r"C:\docs\a.txt"]), &[Some("file-9".into())], &|label| label == "main");
        // The stale owner is ignored and a fresh single-file window is reserved.
        assert_eq!(plan.created.as_ref().map(|(label, _)| label.clone()), Some("file-1".into()));
        assert!(plan.deliveries.is_empty());
    }

    #[test]
    fn external_open_reuses_the_single_file_window_and_never_touches_the_workspace_window() {
        let mut r = LaunchRegistry::default();
        r.insert("main".into(), Vec::new());
        r.insert("file-1".into(), paths(&[r"C:\docs\a.txt"]));
        let plan = plan_external_open(&mut r, &paths(&[r"C:\docs\b.txt"]), &[None], &always);
        assert!(plan.created.is_none(), "已有单文件窗口时不得新建 file-N 窗口");
        assert_eq!(plan.deliveries, vec!["file-1".to_string()]);
        assert!(plan.activate.is_empty(), "未打开的文件不能被当作标签激活");
        assert_eq!(r.windows["file-1"].pending, paths(&[r"C:\docs\b.txt"]));
        // A second request for the same file does not queue it twice.
        let again = plan_external_open(&mut r, &paths(&[r"C:\docs\b.txt"]), &[None], &always);
        assert_eq!(again.deliveries, vec!["file-1".to_string()]);
        assert_eq!(r.windows["file-1"].pending, paths(&[r"C:\docs\b.txt"]));
        assert!(r.windows["main"].pending.is_empty(), "工作区窗口不得被塞入外部文件");
        assert!(r.windows["main"].paths.is_empty());
        assert_eq!(r.order, vec!["main".to_string(), "file-1".to_string()]);
    }

    #[test]
    fn external_open_creates_one_single_file_window_when_only_a_workspace_window_exists() {
        let mut r = LaunchRegistry::default();
        r.insert("main".into(), Vec::new());
        let plan = plan_external_open(&mut r, &paths(&[r"C:\中文 目录\b.txt"]), &[None], &always);
        let (label, initial) = plan.created.expect("必须创建独立单文件窗口");
        assert_eq!(label, "file-1");
        assert_eq!(initial, paths(&[r"C:\中文 目录\b.txt"]));
        assert_eq!(r.windows[&label].kind, LaunchKind::File);
        // The workspace window keeps its tabs and stays untouched.
        assert!(r.windows["main"].paths.is_empty());
        assert!(r.windows["main"].pending.is_empty());
    }

    #[test]
    fn repeated_requests_for_the_same_file_are_merged_into_one_tab() {
        let mut r = LaunchRegistry::default();
        r.insert("main".into(), Vec::new());
        let file = paths(&[r"C:\docs\a.txt"]);
        let first = plan_external_open(&mut r, &file, &[None], &always);
        let (label, _) = first.created.clone().expect("first click creates the window");
        // The window exists but its frontend has not drained anything yet: the
        // second and third clicks must join it, not spawn more windows.
        let second = plan_external_open(&mut r, &file, &[None], &always);
        let third = plan_external_open(&mut r, &file, &[None], &always);
        assert!(second.created.is_none() && third.created.is_none(), "反复双击不得创建多个窗口");
        assert_eq!(second.deliveries, vec![label.clone()]);
        assert!(r.windows[&label].pending.is_empty(), "同一文件只应登记一次标签");
        assert_eq!(r.windows.len(), 2, "只应存在工作区窗口与一个单文件窗口");
    }

    #[test]
    fn a_batch_with_a_known_and_unknown_file_keeps_the_new_file_as_a_tab() {
        let mut r = LaunchRegistry::default();
        r.insert("main".into(), Vec::new());
        r.insert("file-1".into(), paths(&[r"C:\docs\a.txt"]));
        let plan = plan_external_open(
            &mut r,
            &paths(&[r"C:\docs\a.txt", r"C:\docs\new.txt"]),
            &[Some("file-1".into()), None],
            &always,
        );
        // The open file is activated; the new file becomes another tab of the same
        // single-file window instead of spawning a second window.
        assert_eq!(plan.deliveries, vec!["file-1".to_string()]);
        assert_eq!(plan.activate, vec![("file-1".to_string(), paths(&[r"C:\docs\a.txt"]))]);
        assert!(plan.created.is_none(), "已有单文件窗口时不得新建 file-N 窗口");
        assert_eq!(r.windows["file-1"].pending, paths(&[r"C:\docs\new.txt"]));
        assert_eq!(r.windows.len(), 2);
    }

    #[test]
    fn external_open_stops_creating_windows_at_the_cap() {
        let mut r = LaunchRegistry::default();
        r.insert("main".into(), Vec::new());
        for index in 0..(MAX_WINDOWS - 1) {
            r.insert(format!("file-{index}"), paths(&[&format!(r"C:\docs\{index}.txt")]));
        }
        assert_eq!(r.windows.len(), MAX_WINDOWS);
        let plan = plan_external_open(&mut r, &paths(&[r"C:\docs\overflow.txt"]), &[None], &always);
        assert!(plan.created.is_none(), "超过窗口上限后不得继续创建窗口");
        assert_eq!(r.windows.len(), MAX_WINDOWS);
    }

    #[test]
    fn closing_a_window_forgets_its_files_so_a_later_open_creates_one_again() {
        let mut r = LaunchRegistry::default();
        r.insert("main".into(), Vec::new());
        r.insert("file-1".into(), paths(&[r"C:\docs\a.txt"]));
        r.remove("file-1");
        assert!(r.window_for(&PathKey::of(Path::new(r"C:\docs\a.txt"))).is_none());
        let plan = plan_external_open(&mut r, &paths(&[r"C:\docs\a.txt"]), &[None], &always);
        assert!(plan.created.is_some(), "关闭窗口后再次打开应创建窗口而不是复用已销毁记录");
    }

    #[test]
    fn external_paths_are_canonicalized_and_deduplicated_by_identity_not_by_name() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("子 目录");
        std::fs::create_dir(&nested).unwrap();
        let file = nested.join("Same Name.txt");
        std::fs::write(&file, "content").unwrap();
        let relative = {
            let cwd = std::env::current_dir().unwrap();
            let mut up = PathBuf::new();
            for _ in 0..cwd.components().count() {
                up.push("..");
            }
            // A relative path only stays relative if it is actually resolved
            // against the current directory, so build it from there when possible.
            let candidate = pathdiff_from(&cwd, &file);
            if candidate.is_relative() { candidate } else { up.push(&file); up }
        };
        let canonical = crate::files::checked_path(&file, false).unwrap();
        let verbatim = PathBuf::from(format!(r"\\?\{}", canonical.display()));
        let upper = PathBuf::from(canonical.to_string_lossy().to_uppercase());
        let requests = vec![
            canonical.clone(),
            verbatim,
            upper,
            file.clone(),
            relative,
            dir.path().join("missing-file.txt"),
        ];
        let unique = normalize_external_paths(requests);
        assert_eq!(unique, vec![canonical.clone()], "同一文件的别名必须合并为一项");
        // A directory or a missing file is not an openable document.
        assert!(normalize_external_paths(vec![nested.clone()]).is_empty());
        // Names are never the identity: two same-named files stay distinct.
        let other = dir.path().join("Same Name.txt");
        std::fs::write(&other, "other").unwrap();
        assert_eq!(normalize_external_paths(vec![file, other]).len(), 2);
    }

    /// Minimal relative-path helper so the alias test needs no extra dependency.
    fn pathdiff_from(base: &Path, target: &Path) -> PathBuf {
        let base = base.components().collect::<Vec<_>>();
        let target = target.components().collect::<Vec<_>>();
        let shared = base.iter().zip(target.iter()).take_while(|(a, b)| a == b).count();
        let mut result = PathBuf::new();
        for _ in shared..base.len() {
            result.push("..");
        }
        for component in &target[shared..] {
            result.push(component.as_os_str());
        }
        result
    }
}

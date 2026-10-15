use crate::files::{FileService, Layout};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
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
    pub next: u64,
}
impl LaunchRegistry {
    pub fn insert(&mut self, label: String, paths: Vec<PathBuf>) {
        let kind = if paths.is_empty() {
            LaunchKind::App
        } else {
            LaunchKind::File
        };
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
}
pub type LaunchStore = Mutex<LaunchRegistry>;

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
}

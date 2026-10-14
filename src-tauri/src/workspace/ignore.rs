use ignore::gitignore::{Gitignore, GitignoreBuilder};
use std::{
    cell::RefCell,
    collections::HashMap,
    path::{Path, PathBuf},
};

pub struct IgnoreRuleSet {
    root: PathBuf,
    show_ignored: bool,
    cache: RefCell<HashMap<PathBuf, Gitignore>>,
}

impl IgnoreRuleSet {
    pub fn new(root: &Path, show_ignored: bool) -> Self {
        Self {
            root: root.to_path_buf(),
            show_ignored,
            cache: RefCell::new(HashMap::new()),
        }
    }
    pub fn is_ignored(&self, path: &Path, is_dir: bool) -> bool {
        if self.show_ignored {
            return false;
        }
        let relative = match path.strip_prefix(&self.root) {
            Ok(p) => p,
            Err(_) => return true,
        };
        if relative.components().any(|c| {
            [
                ".git",
                "node_modules",
                "target",
                "dist",
                ".lightedit-dev",
                ".tmp",
                ".idea",
                ".vscode",
            ]
            .iter()
            .any(|name| c.as_os_str().to_string_lossy().eq_ignore_ascii_case(name))
        }) {
            return true;
        }
        let mut ancestors: Vec<_> = path
            .parent()
            .unwrap_or(&self.root)
            .ancestors()
            .take_while(|p| p.starts_with(&self.root))
            .collect();
        ancestors.reverse();
        let mut ignored = false;
        let mut cache = self.cache.borrow_mut();
        for directory in ancestors {
            let matcher = cache.entry(directory.to_path_buf()).or_insert_with(|| {
                let mut builder = GitignoreBuilder::new(directory);
                let file = directory.join(".gitignore");
                if super::guard::validate_under_root(&self.root, &file).is_ok()
                    && std::fs::metadata(&file).is_ok_and(|m| m.len() <= 1024 * 1024)
                {
                    let _ = builder.add(&file);
                }
                builder.build().unwrap_or_else(|_| Gitignore::empty())
            });
            let matched = matcher.matched_path_or_any_parents(path, is_dir);
            if !matched.is_none() {
                ignored = matched.is_ignore();
            }
        }
        ignored
    }
}

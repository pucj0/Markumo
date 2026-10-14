use super::{
    guard::{relative_slash_path, validate_under_root},
    ignore::IgnoreRuleSet,
};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::File,
    io::Read,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMatch {
    pub search_id: String,
    pub path: String,
    pub relative_path: String,
    pub line_number: usize,
    pub column_number: usize,
    pub line_text: String,
    pub match_length: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchQuery {
    pub search_id: String,
    pub query: String,
    pub is_case_sensitive: bool,
    pub is_whole_word: bool,
    pub is_regex: bool,
    pub max_results: Option<usize>,
    #[serde(default)]
    pub include_ignored: bool,
}
#[derive(Default, Clone)]
pub struct SearchManager {
    tokens: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}
impl SearchManager {
    pub fn create_token(&self, search_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        let mut map = self.tokens.lock().unwrap();
        if let Some(old) = map.insert(search_id.to_string(), Arc::clone(&flag)) {
            old.store(true, Ordering::Relaxed);
        }
        flag
    }
    pub fn cancel(&self, search_id: &str) {
        if let Some(flag) = self.tokens.lock().unwrap().remove(search_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
    pub fn cleanup(&self, search_id: &str, token: &Arc<AtomicBool>) {
        let mut map = self.tokens.lock().unwrap();
        if map
            .get(search_id)
            .is_some_and(|stored| Arc::ptr_eq(stored, token))
        {
            map.remove(search_id);
        }
    }
}

// Enumeration is requested by search/Quick Open only, never by initial tree loading.
struct TraversalBudget {
    started: Instant,
    count: usize,
}

#[cfg(test)]
mod budget_tests {
    use super::*;
    #[test]
    fn traversal_limit_and_deadline_are_shared_between_roots() {
        let dir = tempfile::tempdir().unwrap();
        let roots = [dir.path().join("a"), dir.path().join("b")];
        for root in &roots {
            std::fs::create_dir(root).unwrap();
            std::fs::write(root.join("same.txt"), "data").unwrap();
        }
        let token = AtomicBool::new(false);
        let mut budget = TraversalBudget {
            started: Instant::now(),
            count: 99_999,
        };
        walk_files_budget(&roots[0], false, &token, &mut budget, |_| true).unwrap();
        assert!(walk_files_budget(&roots[1], false, &token, &mut budget, |_| true).is_err());
        let mut expired = TraversalBudget {
            started: Instant::now() - Duration::from_secs(11),
            count: 0,
        };
        assert!(
            walk_files_budget(&roots[0], false, &token, &mut expired, |_| panic!(
                "expired traversal visited file"
            ))
            .is_err()
        );
        let files = find_files_roots(&roots, "b/same", false).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].relative_path, "b/same.txt");
    }
}
impl TraversalBudget {
    fn new() -> Self {
        Self {
            started: Instant::now(),
            count: 0,
        }
    }
}

fn walk_files_budget(
    root: &Path,
    include_ignored: bool,
    token: &AtomicBool,
    budget: &mut TraversalBudget,
    mut visit: impl FnMut(&Path) -> bool,
) -> Result<(), String> {
    let canonical = validate_under_root(root, root).map_err(|e| e.to_string())?;
    let root = canonical.as_path();
    let rules = IgnoreRuleSet::new(root, include_ignored);
    let mut directories = vec![root.to_path_buf()];
    while let Some(dir) = directories.pop() {
        if token.load(Ordering::Relaxed) {
            return Ok(());
        }
        let valid = match validate_under_root(root, &dir) {
            Ok(p) => p,
            Err(_) => continue,
        };
        let entries = match std::fs::read_dir(valid) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            if token.load(Ordering::Relaxed) {
                return Ok(());
            }
            budget.count += 1;
            if budget.count > 100_000 || budget.started.elapsed() > Duration::from_secs(10) {
                return Err("检索达到 10 秒/10 万条目限制；请缩小工作区或启用忽略规则".into());
            }
            let path = entry.path();
            let kind = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if metadata.file_attributes() & 0x400 != 0 {
                    continue;
                }
            }
            #[cfg(not(windows))]
            let _ = metadata;
            // Paths are direct entries of an already validated directory. Never follow links.
            if kind.is_symlink() || rules.is_ignored(&path, kind.is_dir()) {
                continue;
            }
            if kind.is_dir() {
                directories.push(path);
            } else if kind.is_file() && !visit(&path) {
                return Ok(());
            }
        }
    }
    Ok(())
}

#[derive(Serialize)]
pub struct QuickFile {
    pub name: String,
    pub path: String,
    pub relative_path: String,
}
#[cfg(test)]
pub fn find_files(
    root: &Path,
    query: &str,
    include_ignored: bool,
) -> Result<Vec<QuickFile>, String> {
    find_files_budget(
        root,
        query,
        include_ignored,
        &mut TraversalBudget::new(),
        "",
        100,
    )
}

pub fn find_files_roots(
    roots: &[std::path::PathBuf],
    query: &str,
    include_ignored: bool,
) -> Result<Vec<QuickFile>, String> {
    let mut budget = TraversalBudget::new();
    let mut files = Vec::new();
    for root in roots {
        let prefix = if roots.len() > 1 {
            format!(
                "{}/",
                root.file_name().unwrap_or_default().to_string_lossy()
            )
        } else {
            String::new()
        };
        files.extend(find_files_budget(
            root,
            query,
            include_ignored,
            &mut budget,
            &prefix,
            100 - files.len(),
        )?);
        if files.len() >= 100 {
            break;
        }
    }
    Ok(files)
}

fn find_files_budget(
    root: &Path,
    query: &str,
    include_ignored: bool,
    budget: &mut TraversalBudget,
    prefix: &str,
    limit: usize,
) -> Result<Vec<QuickFile>, String> {
    let canonical = validate_under_root(root, root).map_err(|e| e.to_string())?;
    let root = canonical.as_path();
    let query = query.to_lowercase();
    let mut results = Vec::new();
    walk_files_budget(
        root,
        include_ignored,
        &AtomicBool::new(false),
        budget,
        |path| {
            let relative = format!("{prefix}{}", relative_slash_path(root, path));
            let lower = relative.to_lowercase();
            let mut chars = lower.chars();
            if query
                .chars()
                .all(|wanted| chars.by_ref().any(|c| c == wanted))
            {
                results.push(QuickFile {
                    name: path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned(),
                    path: path.to_string_lossy().into_owned(),
                    relative_path: relative,
                });
            }
            results.len() < limit
        },
    )?;
    Ok(results)
}

pub struct WorkspaceSearcher;
impl WorkspaceSearcher {
    pub fn execute_search_roots<F>(
        roots: &[std::path::PathBuf],
        query: &SearchQuery,
        token: Arc<AtomicBool>,
        mut on_batch: F,
    ) -> Result<usize, String>
    where
        F: FnMut(Vec<SearchMatch>),
    {
        let max = query.max_results.unwrap_or(1000).clamp(1, 1000);
        let mut total = 0;
        let mut budget = TraversalBudget::new();
        for root in roots {
            if total >= max || token.load(Ordering::Relaxed) {
                break;
            }
            if budget.started.elapsed() > Duration::from_secs(10) {
                return Err("工作区搜索达到时间限制；请缩小范围".into());
            }
            let mut current = query.clone();
            current.max_results = Some(max - total);
            Self::execute_search_budget(
                root,
                &current,
                token.clone(),
                &mut budget,
                |mut batch| {
                    total += batch.len();
                    if roots.len() > 1 {
                        for item in &mut batch {
                            item.relative_path = format!(
                                "{}/{}",
                                root.file_name().unwrap_or_default().to_string_lossy(),
                                item.relative_path
                            );
                        }
                    }
                    on_batch(batch);
                },
            )?;
        }
        Ok(total)
    }

    #[cfg(test)]
    pub fn execute_search<F>(
        root: &Path,
        query: &SearchQuery,
        token: Arc<AtomicBool>,
        on_batch: F,
    ) -> Result<usize, String>
    where
        F: FnMut(Vec<SearchMatch>),
    {
        Self::execute_search_budget(root, query, token, &mut TraversalBudget::new(), on_batch)
    }

    fn execute_search_budget<F>(
        root: &Path,
        query: &SearchQuery,
        token: Arc<AtomicBool>,
        budget: &mut TraversalBudget,
        mut on_batch: F,
    ) -> Result<usize, String>
    where
        F: FnMut(Vec<SearchMatch>),
    {
        let canonical = validate_under_root(root, root).map_err(|e| e.to_string())?;
        let root = canonical.as_path();
        if query.query.is_empty() {
            return Ok(0);
        }
        let max_results = query.max_results.unwrap_or(1000).clamp(1, 1000);
        let mut pattern = if query.is_regex {
            query.query.clone()
        } else {
            regex::escape(&query.query)
        };
        if query.is_whole_word {
            pattern = format!(r"\b(?:{})\b", pattern);
        }
        let regex = RegexBuilder::new(&pattern)
            .case_insensitive(!query.is_case_sensitive)
            .size_limit(1024 * 1024)
            .build()
            .map_err(|e| format!("正则表达式无效: {e}"))?;
        let mut total = 0;
        let mut batch = Vec::with_capacity(32);
        walk_files_budget(root, query.include_ignored, &token, budget, |path| {
            Self::search_file(
                path,
                root,
                &regex,
                query,
                &token,
                &mut total,
                max_results,
                &mut batch,
                &mut on_batch,
            );
            total < max_results && !token.load(Ordering::Relaxed)
        })?;
        if !token.load(Ordering::Relaxed) && !batch.is_empty() {
            on_batch(batch);
        }
        Ok(total)
    }
    #[allow(clippy::too_many_arguments)]
    fn search_file(
        path: &Path,
        root: &Path,
        regex: &Regex,
        query: &SearchQuery,
        token: &AtomicBool,
        total: &mut usize,
        max: usize,
        batch: &mut Vec<SearchMatch>,
        on_batch: &mut impl FnMut(Vec<SearchMatch>),
    ) {
        let file = match File::open(path) {
            Ok(f) => f,
            Err(_) => return,
        };
        if !file.metadata().is_ok_and(|m| m.len() <= 10 * 1024 * 1024) {
            return;
        }
        let mut bytes = Vec::new();
        if file
            .take(10 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .is_err()
            || bytes.len() > 10 * 1024 * 1024
        {
            return;
        }
        let text = match crate::files::decode_search_text(&bytes) {
            Ok(t) => t,
            Err(_) => return,
        };
        // Match CodeMirror's normalized LF line positions, including CR-only files.
        let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
        let relative = relative_slash_path(root, path);
        for (index, line) in normalized.split('\n').enumerate() {
            if token.load(Ordering::Relaxed) {
                return;
            }
            for matched in regex.find_iter(line) {
                if token.load(Ordering::Relaxed) || *total >= max {
                    return;
                }
                *total += 1;
                batch.push(SearchMatch {
                    search_id: query.search_id.clone(),
                    path: path.to_string_lossy().into_owned(),
                    relative_path: relative.clone(),
                    line_number: index + 1,
                    column_number: line[..matched.start()].encode_utf16().count() + 1,
                    match_length: matched.as_str().encode_utf16().count(),
                    line_text: line.chars().take(1024).collect(),
                });
                if batch.len() == 32 && !token.load(Ordering::Relaxed) {
                    on_batch(std::mem::take(batch));
                }
            }
        }
    }
}

//! Workspace replace uses the searcher's Rust regex and line boundaries. No JS regex runs.
use super::{
    guard::validate_under_root,
    ignore::IgnoreRuleSet,
    search::{compile_query, in_directory, SearchQuery},
    WorkspaceSearcher,
};
use crate::files::{atomic, codec, read_disk};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

pub const MAX_FILE: usize = 10 * 1024 * 1024;
pub const MAX_PREVIEW: usize = 32 * 1024 * 1024;
pub const MAX_MATCHES: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplaceEdit {
    pub from: usize, // UTF-16 offsets for DocumentManager
    pub to: usize,
    pub line: usize,
    pub column: usize,
    pub before: String,
    pub insert: String,
    pub context: String,
    #[serde(skip)]
    start: usize,
    #[serde(skip)]
    end: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplaceFile {
    pub path: String,
    pub version: String,
    pub buffer: bool,
    pub edits: Vec<ReplaceEdit>,
}

#[derive(Debug, Serialize)]
pub struct ReplacePreview {
    pub files: Vec<ReplaceFile>,
    pub skipped: Vec<String>,
    pub limited: bool,
    pub canceled: bool,
}

#[derive(Debug, Deserialize)]
pub struct ReplaceApply {
    pub query: SearchQuery,
    pub replacement: String,
    pub path: String,
    pub version: String,
    pub selected: Vec<usize>,
}

pub fn validate_query(query: &SearchQuery) -> Result<(), String> {
    if query.query.is_empty() || query.query.len() > 16 * 1024 {
        return Err("请输入不超过 16 KiB 的搜索表达式".into());
    }
    if query.buffers.len() > MAX_MATCHES
        || query.buffers.iter().any(|b| b.text.len() > MAX_FILE)
        || query.buffers.iter().map(|b| b.text.len()).sum::<usize>() > MAX_PREVIEW
    {
        return Err("编辑缓冲区超过 10 MiB/文件、32 MiB/批次预算；请缩小范围".into());
    }
    Ok(())
}

// Replacement never inherits the tree's 'show ignored' override.
pub fn allowed_path(
    roots: &[PathBuf],
    path: &Path,
    query: &SearchQuery,
) -> Result<PathBuf, String> {
    let root = roots
        .iter()
        .filter(|root| path.starts_with(root))
        .max_by_key(|root| root.components().count())
        .ok_or("文件不在授权工作区")?;
    let valid = validate_under_root(root, path).map_err(|e| e.to_string())?;
    if !in_directory(&valid, query) || IgnoreRuleSet::new(root, false).is_ignored(&valid, false) {
        return Err("文件在搜索范围之外或被忽略".into());
    }
    let ext = valid
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if [
        "pdf", "png", "apng", "jpg", "jpeg", "jfif", "pjpeg", "pjp", "gif", "webp", "svg", "svgz",
        "avif", "bmp", "dib", "ico", "cur", "tif", "tiff", "heic", "heif", "jxl", "psd", "tga",
        "mp3", "mp4", "m4a", "aac", "flac", "wav", "ogg", "webm", "mov", "avi", "class",
    ]
    .contains(&ext.as_str())
    {
        return Err("跳过不可编辑媒体或二进制文件".into());
    }
    if !std::fs::metadata(&valid).is_ok_and(|m| m.is_file() && m.len() <= MAX_FILE as u64) {
        return Err("不是允许大小的普通文件".into());
    }
    Ok(valid)
}

/// Preserve the exact separators outside matches, including mixed CRLF/LF/CR.
/// Rust captures::expand: $0, $1, ${1}, $name, ${name}, $$; missing groups => empty.
pub fn edits(
    text: &str,
    query: &SearchQuery,
    replacement: &str,
    limit: usize,
    token: &AtomicBool,
) -> Result<Vec<ReplaceEdit>, String> {
    if text.len() > MAX_FILE || replacement.len() > 16 * 1024 {
        return Err("替换超出文件或替换文本预算".into());
    }
    let regex = compile_query(query)?;
    let mut edits = Vec::new();
    let mut start = 0;
    let mut utf16 = 0;
    let mut line_number = 1;
    let started = Instant::now();
    let default_eol = codec::eol(text);
    loop {
        if token.load(Ordering::Relaxed) {
            return Err("预览已取消".into());
        }
        if started.elapsed() > Duration::from_secs(10) {
            return Err("替换达到时间预算，请缩小范围".into());
        }
        let rest = &text[start..];
        let len = rest.find(['\r', '\n']).unwrap_or(rest.len());
        let line = &rest[..len];
        let separator = if rest[len..].starts_with("\r\n") {
            "\r\n"
        } else if rest[len..].starts_with('\r') {
            "\r"
        } else if default_eol == "CRLF" {
            "\r\n"
        } else if default_eol == "CR" {
            "\r"
        } else {
            "\n"
        };
        for captures in regex.captures_iter(line) {
            if edits.len() >= limit {
                return Ok(edits);
            }
            if token.load(Ordering::Relaxed) || started.elapsed() > Duration::from_secs(10) {
                return Err("替换已取消或达到时间预算".into());
            }
            let matched = captures.get(0).unwrap();
            let mut insert = String::new();
            if query.is_regex {
                // expand() accepts a String, not a bounded writer. Bound its
                // allocation before calling it (conservative for unused groups).
                let largest_capture = captures
                    .iter()
                    .flatten()
                    .map(|m| m.len())
                    .max()
                    .unwrap_or(0);
                let references = replacement.bytes().filter(|b| *b == b'$').count();
                if largest_capture
                    .saturating_mul(references)
                    .saturating_add(replacement.len())
                    > MAX_FILE
                {
                    return Err("捕获组展开上界超过 10 MiB 预算".into());
                }
                captures.expand(replacement, &mut insert);
            } else {
                insert.push_str(replacement);
            }
            insert = insert
                .replace("\r\n", "\n")
                .replace('\r', "\n")
                .replace('\n', separator);
            if insert.len() > MAX_FILE {
                return Err("捕获组展开超出预算".into());
            }
            let column = line[..matched.start()].encode_utf16().count();
            let before = matched.as_str().to_string();
            edits.push(ReplaceEdit {
                from: utf16 + column,
                to: utf16 + column + before.encode_utf16().count(),
                line: line_number,
                column: column + 1,
                before,
                insert,
                context: line
                    .chars()
                    .skip(line[..matched.start()].chars().count().saturating_sub(80))
                    .take(180)
                    .collect(),
                start: start + matched.start(),
                end: start + matched.end(),
            });
            if edits
                .iter()
                .map(|e| e.before.len() + e.insert.len() + e.context.len())
                .sum::<usize>()
                > MAX_PREVIEW
            {
                return Err("预览内容超过 32 MiB 预算".into());
            }
        }
        if len == rest.len() {
            break;
        }
        let separator = if rest[len..].starts_with("\r\n") {
            2
        } else {
            1
        };
        utf16 += rest[..len + separator].encode_utf16().count();
        start += len + separator;
        line_number += 1;
    }
    Ok(edits)
}

fn preview_single_file(
    roots: &[PathBuf],
    target_str: &str,
    query: &SearchQuery,
    replacement: &str,
    hit_limit: usize,
    token: &AtomicBool,
    size: &mut usize,
) -> Result<Option<ReplaceFile>, String> {
    let path = allowed_path(roots, Path::new(target_str), query)?;
    let (bytes, version, read_only) = read_disk(&path).map_err(|e| e.to_string())?;
    if crate::files::media::is_media_content(&bytes) {
        return Err("跳过媒体内容（与扩展名无关）".into());
    }
    if read_only {
        return Err("文件没有写入权限".into());
    }
    let buffer = query.buffers.iter().find(|b| {
        let bp = Path::new(&b.path);
        bp == path
            || bp == Path::new(target_str)
            || b.path
                .replace('/', "\\")
                .trim_start_matches(r"\\?\")
                .eq_ignore_ascii_case(path.to_string_lossy().replace('/', "\\").trim_start_matches(r"\\?\"))
    });
    let (disk, encoding, bom) = codec::decode_with_path(
        &bytes,
        buffer.and_then(|b| b.encoding.as_deref()),
        Some(&path),
    )
    .map_err(|e| e.to_string())?;
    // Reject ambiguous/non-bijective legacy decoding before offering a replacement.
    if codec::encode(&disk, &encoding, bom).map_err(|e| e.to_string())? != bytes {
        return Err("源文件编码无法无损往返".into());
    }
    let text = buffer.map(|b| b.text.as_str()).unwrap_or(&disk);
    let changes = edits(text, query, replacement, hit_limit, token)?;
    *size += text.len()
        + changes
            .iter()
            .map(|e| e.before.len() + e.insert.len() + e.context.len())
            .sum::<usize>();
    if *size > MAX_PREVIEW {
        return Err("预览超过 32 MiB 预算，请缩小目录范围".into());
    }
    if changes.is_empty() {
        return Ok(None);
    }
    Ok(Some(ReplaceFile {
        path: target_str.to_string(),
        version,
        buffer: buffer.is_some(),
        edits: changes,
    }))
}

pub fn preview(
    roots: &[PathBuf],
    query: &SearchQuery,
    replacement: &str,
    targets: &[String],
    token: Arc<AtomicBool>,
) -> Result<ReplacePreview, String> {
    validate_query(query)?;
    let started = Instant::now();
    if replacement.len() > 16 * 1024 || targets.len() > MAX_MATCHES {
        return Err("替换请求超出预算".into());
    }
    let max_results = query
        .max_results
        .unwrap_or(MAX_MATCHES)
        .clamp(1, MAX_MATCHES);

    if !targets.is_empty() {
        let mut files = Vec::new();
        let mut skipped = Vec::new();
        let mut size = 0;
        let mut total_matches = 0;
        let mut limited = false;
        let mut seen = HashSet::new();

        for target in targets {
            if token.load(Ordering::Relaxed) {
                break;
            }
            if started.elapsed() > Duration::from_secs(10) || size > MAX_PREVIEW {
                limited = true;
                skipped.push("预览达到 10 秒/32 MiB 预算，剩余文件未处理；请缩小目录范围".into());
                break;
            }
            if !seen.insert(target.clone()) {
                continue;
            }
            let remaining = max_results.saturating_sub(total_matches);
            if remaining == 0 {
                limited = true;
                break;
            }
            let file = preview_single_file(roots, target, query, replacement, remaining, &token, &mut size)?;
            if let Some(file) = file {
                if file.edits.len() >= remaining {
                    limited = true;
                }
                total_matches += file.edits.len();
                files.push(file);
            }
        }

        return Ok(ReplacePreview {
            files,
            skipped,
            limited,
            canceled: token.load(Ordering::Relaxed),
        });
    }

    let mut hits = Vec::new();
    WorkspaceSearcher::execute_search_roots(roots, query, token.clone(), |batch| {
        hits.extend(batch)
    })?;
    let mut limited = hits.len() >= max_results;
    let mut seen = HashSet::new();
    let mut hit_counts = HashMap::new();
    for hit in &hits {
        *hit_counts.entry(hit.path.clone()).or_insert(0usize) += 1;
    }
    let mut files = Vec::new();
    let mut skipped = Vec::new();
    let mut size = 0;
    for hit in hits {
        if token.load(Ordering::Relaxed) {
            break;
        }
        if started.elapsed() > Duration::from_secs(10) || size > MAX_PREVIEW {
            limited = true;
            skipped.push("预览达到 10 秒/32 MiB 预算，剩余文件未处理；请缩小目录范围".into());
            break;
        }
        if !seen.insert(hit.path.clone()) {
            continue;
        }
        let count = files
            .iter()
            .map(|f: &ReplaceFile| f.edits.len())
            .sum::<usize>();
        let remaining = max_results
            .saturating_sub(count)
            .min(hit_counts.get(&hit.path).copied().unwrap_or(0));
        match preview_single_file(roots, &hit.path, query, replacement, remaining, &token, &mut size) {
            Ok(Some(file)) => files.push(file),
            Ok(None) => {}
            Err(error) => skipped.push(format!("{}：{error}", hit.path)),
        }
    }
    Ok(ReplacePreview {
        files,
        skipped,
        limited,
        canceled: token.load(Ordering::Relaxed),
    })
}

pub fn apply(roots: &[PathBuf], request: &ReplaceApply) -> Result<usize, String> {
    validate_query(&request.query)?;
    if request.selected.is_empty() || request.selected.len() > MAX_MATCHES {
        return Err("未选择匹配项或超出预算".into());
    }
    if !request.query.buffers.is_empty() {
        return Err("已打开文件必须通过编辑器事务修改".into());
    }
    let path = allowed_path(roots, Path::new(&request.path), &request.query)?;
    let (bytes, version, read_only) = read_disk(&path).map_err(|e| e.to_string())?;
    if crate::files::media::is_media_content(&bytes) {
        return Err("跳过媒体内容（与扩展名无关）".into());
    }
    if version != request.version {
        return Err("文件版本已变化；请重新生成预览，未写入过期偏移量".into());
    }
    if read_only {
        return Err("文件没有写入权限".into());
    }
    let (text, encoding, bom) =
        codec::decode_with_path(&bytes, None, Some(&path)).map_err(|e| e.to_string())?;
    if codec::encode(&text, &encoding, bom).map_err(|e| e.to_string())? != bytes {
        return Err("源文件编码无法无损往返".into());
    }
    // Always recompute captures and byte boundaries from the freshly checked file.
    let changes = edits(
        &text,
        &request.query,
        &request.replacement,
        MAX_MATCHES,
        &AtomicBool::new(false),
    )?;
    let selected: HashSet<_> = request.selected.iter().copied().collect();
    if selected.len() != request.selected.len() || selected.iter().any(|i| *i >= changes.len()) {
        return Err("选择项无效，请重新预览".into());
    }
    let mut output = String::new();
    let mut cursor = 0;
    for (_, change) in changes
        .iter()
        .enumerate()
        .filter(|(index, _)| selected.contains(index))
    {
        output.push_str(&text[cursor..change.start]);
        output.push_str(&change.insert);
        cursor = change.end;
        if output.len() > MAX_FILE {
            return Err("替换输出超过 10 MiB 预算".into());
        }
    }
    output.push_str(&text[cursor..]);
    let encoded = codec::encode(&output, &encoding, bom).map_err(|e| e.to_string())?;
    if encoded.len() > MAX_FILE {
        return Err("编码后文件超过 10 MiB 预算".into());
    }
    if encoded == bytes {
        return Ok(selected.len());
    }
    allowed_path(roots, &path, &request.query)?;
    atomic::write_checked_preserving_identity(&path, &encoded, Some(&version))
        .map_err(|e| e.to_string())?;
    Ok(selected.len())
}

pub fn apply_closed(
    roots: &[PathBuf],
    request: &ReplaceApply,
    files: &crate::files::FileService,
) -> Result<usize, String> {
    let path = allowed_path(roots, Path::new(&request.path), &request.query)?;
    if files.has_grants_under(&path) {
        return Err("文件已经在编辑器窗口中打开；请重新预览并通过文档事务替换".into());
    }
    apply(roots, request)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn query(text: &str) -> SearchQuery {
        serde_json::from_value(serde_json::json!({"search_id":"test", "query":text, "is_case_sensitive":true, "is_whole_word":false, "is_regex":false})).unwrap()
    }
    fn fixture() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let path = root.join("a.txt");
        std::fs::write(&path, "foo foo\r\nfoo").unwrap();
        (directory, root, path)
    }
    fn request(
        root: &Path,
        path: &Path,
        query: SearchQuery,
        replacement: &str,
        selected: Vec<usize>,
    ) -> ReplaceApply {
        let _ = root;
        ReplaceApply {
            query,
            replacement: replacement.into(),
            path: path.to_string_lossy().into(),
            version: read_disk(path).unwrap().1,
            selected,
        }
    }

    #[test]
    fn shared_rust_typescript_contract_vectors() {
        let vectors: serde_json::Value = serde_json::from_str(include_str!(
            "../../../scripts/fixtures/workspace-replace.json"
        ))
        .unwrap();
        for vector in vectors.as_array().unwrap() {
            let mut q = query(vector["query"].as_str().unwrap());
            q.is_regex = vector["regex"].as_bool().unwrap();
            q.is_whole_word = vector["whole"].as_bool().unwrap();
            q.is_case_sensitive = vector["caseSensitive"].as_bool().unwrap();
            let text = vector["text"].as_str().unwrap();
            let changes = edits(
                text,
                &q,
                vector["replacement"].as_str().unwrap(),
                MAX_MATCHES,
                &AtomicBool::new(false),
            )
            .unwrap();
            let actual: Vec<_> = changes
                .iter()
                .map(|e| serde_json::json!([e.from, e.to, e.insert]))
                .collect();
            assert_eq!(
                serde_json::json!(actual),
                vector["edits"],
                "{}",
                vector["name"]
            );
            let mut output = String::new();
            let mut cursor = 0;
            for edit in changes {
                output.push_str(&text[cursor..edit.start]);
                output.push_str(&edit.insert);
                cursor = edit.end;
            }
            output.push_str(&text[cursor..]);
            assert_eq!(
                output,
                vector["after"].as_str().unwrap(),
                "{}",
                vector["name"]
            );
        }
    }

    #[test]
    fn preview_is_read_only_and_partial_apply_recomputes_ranges() {
        let (_dir, root, path) = fixture();
        let q = query("foo");
        let preview = preview(
            &[root.clone()],
            &q,
            "bar",
            &[],
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
        assert_eq!(preview.files.len(), 1);
        assert_eq!(preview.files[0].edits.len(), 3);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "foo foo\r\nfoo");
        let req = request(&root, &path, q, "bar", vec![1]);
        assert_eq!(apply(&[root.clone()], &req).unwrap(), 1);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "foo bar\r\nfoo");
        let same = request(&root, &path, query("bar"), "bar", vec![0]);
        let version = same.version.clone();
        apply(&[root], &same).unwrap();
        assert_eq!(read_disk(&path).unwrap().1, version);
    }

    #[test]
    fn stale_disk_and_invalid_selection_never_write() {
        let (_dir, root, path) = fixture();
        let req = request(&root, &path, query("foo"), "bar", vec![0]);
        std::fs::write(&path, "new foo").unwrap();
        assert!(apply(&[root.clone()], &req).unwrap_err().contains("版本"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new foo");
        for indices in [vec![1000], vec![0, 0], vec![]] {
            assert!(apply(
                &[root.clone()],
                &request(&root, &path, query("foo"), "bar", indices)
            )
            .is_err());
        }
        assert_eq!(std::fs::read_to_string(path).unwrap(), "new foo");
    }

    #[test]
    fn encoding_bom_and_line_endings_are_preserved() {
        let (_dir, root, path) = fixture();
        for (encoding, bom, text, replacement) in [
            ("UTF-8", true, "中文\r\n中文\n中文\r", "替换"),
            ("UTF-16LE", true, "中文\r\n中文", "替换"),
            ("UTF-16BE", true, "中文\r中文", "替换"),
            ("GB18030", false, "中文\n中文", "替换"),
            ("windows-1252", false, "café\r\ncafé", "été"),
        ] {
            let before = codec::encode(text, encoding, bom).unwrap();
            std::fs::write(&path, before).unwrap();
            let search = if encoding == "windows-1252" {
                "café"
            } else {
                "中文"
            };
            let req = request(&root, &path, query(search), replacement, vec![0, 1]);
            apply(&[root.clone()], &req).unwrap();
            let expected = text.replacen(search, replacement, 2);
            assert_eq!(
                std::fs::read(&path).unwrap(),
                codec::encode(&expected, encoding, bom).unwrap(),
                "{encoding}"
            );
        }
        std::fs::write(&path, codec::encode("café", "windows-1252", false).unwrap()).unwrap();
        let req = request(&root, &path, query("café"), "中文", vec![0]);
        assert!(apply(&[root], &req).is_err());
    }

    #[test]
    fn multiple_files_ignore_media_binary_directory_and_authorization() {
        let (_dir, root, path) = fixture();
        std::fs::write(root.join("b.txt"), "foo").unwrap();
        std::fs::write(root.join("hidden.txt"), "foo").unwrap();
        std::fs::write(root.join(".gitignore"), "hidden.txt\n").unwrap();
        std::fs::write(root.join("fake.pdf"), "foo").unwrap();
        std::fs::write(root.join("data.bin"), b"foo\0foo").unwrap();
        std::fs::write(root.join("disguised.txt"), "<svg>foo</svg>").unwrap();
        let q = query("foo");
        let p = preview(
            &[root.clone()],
            &q,
            "bar",
            &[],
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
        assert_eq!(p.files.len(), 2);
        assert_eq!(p.skipped.len(), 2);
        assert!(allowed_path(&[root.clone()], &root.join("hidden.txt"), &q).is_err());
        let mut show = q.clone();
        show.include_ignored = true;
        assert!(allowed_path(&[root.clone()], &root.join("hidden.txt"), &show).is_err());
        assert!(allowed_path(&[], &path, &q).is_err());
        let mut scoped = q.clone();
        scoped.directory = Some(root.join("missing").to_string_lossy().into());
        assert!(preview(
            &[root.clone()],
            &scoped,
            "bar",
            &[],
            Arc::new(AtomicBool::new(false))
        )
        .is_err());
        let scope = root.join("scoped");
        std::fs::create_dir(&scope).unwrap();
        std::fs::write(scope.join("one.txt"), "foo").unwrap();
        scoped.directory = Some(
            scope
                .to_string_lossy()
                .trim_start_matches(r"\\?\")
                .to_string(),
        );
        let scoped_preview = preview(
            &[root.clone()],
            &scoped,
            "bar",
            &[],
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
        assert_eq!(scoped_preview.files.len(), 1);
        assert!(allowed_path(&[root.clone()], &path, &scoped).is_err());
        for f in p.files {
            let req = request(
                &root,
                Path::new(&f.path),
                q.clone(),
                "bar",
                (0..f.edits.len()).collect(),
            );
            apply(&[root.clone()], &req).unwrap();
        }
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "bar bar\r\nbar");
    }

    #[test]
    fn buffer_is_authoritative_even_when_disk_has_no_matches() {
        let (_dir, root, path) = fixture();
        std::fs::write(&path, "disk").unwrap();
        let mut q = query("中文");
        q.buffers.push(super::super::search::SearchBuffer {
            path: path.to_string_lossy().into(),
            text: "😀中文 中文".into(),
            encoding: Some("UTF-8".into()),
        });
        let p = preview(
            &[root.clone()],
            &q,
            "替",
            &[],
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
        assert!(p.files[0].buffer);
        assert_eq!(p.files[0].edits[0].from, 2);
        assert!(apply(&[root.clone()], &request(&root, &path, q, "替", vec![0])).is_err());
        assert_eq!(std::fs::read_to_string(path).unwrap(), "disk");
    }

    #[test]
    fn cancellation_match_and_size_budgets() {
        let (_dir, root, path) = fixture();
        let q = query("foo");
        assert!(
            preview(
                &[root.clone()],
                &q,
                "bar",
                &[],
                Arc::new(AtomicBool::new(true))
            )
            .unwrap()
            .canceled
        );
        assert!(edits("foo", &q, "bar", 1000, &AtomicBool::new(true)).is_err());
        std::fs::write(&path, "foo ".repeat(1200)).unwrap();
        let p = preview(
            &[root.clone()],
            &q,
            "bar",
            &[],
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
        assert!(p.limited);
        assert_eq!(p.files[0].edits.len(), 1000);
        assert!(edits(
            &"x".repeat(MAX_FILE + 1),
            &q,
            "",
            1000,
            &AtomicBool::new(false)
        )
        .is_err());
        assert!(edits("foo", &q, &"x".repeat(16385), 1000, &AtomicBool::new(false)).is_err());
        let mut invalid = q;
        invalid.is_regex = true;
        invalid.query = "(?=foo)".into();
        assert!(compile_query(&invalid).is_err()); // no backtracking/lookaround engine
        invalid.query = "(x+)".into();
        assert!(edits(
            &"x".repeat(1024 * 1024),
            &invalid,
            &"$1".repeat(20),
            1000,
            &AtomicBool::new(false)
        )
        .unwrap_err()
        .contains("展开上界"));
    }

    #[test]
    fn explicit_open_encoding_and_other_window_grants_are_safe() {
        let (_dir, root, path) = fixture();
        std::fs::write(&path, codec::encode("中文", "UTF-16LE", false).unwrap()).unwrap();
        let mut q = query("中文");
        q.buffers.push(super::super::search::SearchBuffer {
            path: path.to_string_lossy().into(),
            text: "中文 中文".into(),
            encoding: Some("UTF-16LE".into()),
        });
        let p = preview(
            &[root.clone()],
            &q,
            "替换",
            &[],
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
        assert_eq!(p.files[0].edits.len(), 2);
        std::fs::write(&path, "foo").unwrap();
        let req = request(&root, &path, query("foo"), "bar", vec![0]);
        let mut files = crate::files::FileService::default();
        files.set_owner("another-window");
        files.open_selected(path.clone(), None).unwrap();
        assert!(apply_closed(&[root], &req, &files)
            .unwrap_err()
            .contains("已经在编辑器窗口"));
        assert_eq!(std::fs::read_to_string(path).unwrap(), "foo");
    }

    #[test]
    fn read_only_and_interrupted_writes_report_failure_without_success() {
        let (_dir, root, path) = fixture();
        let req = request(&root, &path, query("foo"), "bar", vec![0]);
        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&path, permissions.clone()).unwrap();
        assert!(apply(&[root.clone()], &req).is_err());
        permissions.set_readonly(false);
        std::fs::set_permissions(&path, permissions).unwrap();
        let req = request(&root, &path, query("foo"), "bar", vec![0]);
        #[cfg(windows)]
        let failure = atomic::fault::PARTIAL_WRITE;
        #[cfg(not(windows))]
        let failure = atomic::fault::TEMP_WRITE;
        atomic::fault::set(failure);
        let result = apply(&[root], &req);
        atomic::fault::clear();
        assert!(result.is_err());
        assert_eq!(std::fs::read_to_string(path).unwrap(), "foo foo\r\nfoo");
    }

    #[cfg(windows)]
    #[test]
    fn junctions_cannot_bypass_replace_scope() {
        let (_dir, root, _) = fixture();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("a.txt"), "foo").unwrap();
        let link = root.join("link");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(status.status.success());
        assert!(allowed_path(&[root], &link.join("a.txt"), &query("foo")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_bypass_replace_scope() {
        let (_dir, root, path) = fixture();
        let link = root.join("link.txt");
        std::os::unix::fs::symlink(path, &link).unwrap();
        assert!(allowed_path(&[root], &link, &query("foo")).is_err());
    }

    #[test]
    fn single_target_preview_not_blocked_by_oversized_file() {
        let (_dir, root, _path) = fixture();
        // File A with > 1000 matches
        let a_path = root.join("a_many.txt");
        let a_content = "target_word\n".repeat(1005);
        std::fs::write(&a_path, &a_content).unwrap();

        // File B with 3 matches
        let b_path = root.join("b_target.txt");
        std::fs::write(&b_path, "target_word one\ntarget_word two\ntarget_word three\n").unwrap();

        let q = query("target_word");

        // Preview targeting only B must succeed and get all 3 matches without being blocked by A
        let p = preview(
            &[root.clone()],
            &q,
            "replaced",
            &[b_path.to_string_lossy().into()],
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();

        assert_eq!(p.files.len(), 1);
        assert_eq!(p.files[0].path, b_path.to_string_lossy());
        assert_eq!(p.files[0].edits.len(), 3);
        assert!(!p.limited);
    }

    #[test]
    fn targeted_preview_target_exceeding_1000_matches_is_limited() {
        let (_dir, root, _path) = fixture();
        let b_path = root.join("b_many.txt");
        let b_content = "word\n".repeat(1005);
        std::fs::write(&b_path, &b_content).unwrap();

        let q = query("word");
        let p = preview(
            &[root.clone()],
            &q,
            "replaced",
            &[b_path.to_string_lossy().into()],
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();

        assert_eq!(p.files.len(), 1);
        assert_eq!(p.files[0].edits.len(), 1000);
        assert!(p.limited);
    }

    #[test]
    fn targeted_preview_rejects_ignored_and_unauthorized_targets() {
        let (_dir, root, _path) = fixture();
        // 1. Target in ignored directory or matching .gitignore
        let ignored_path = root.join("ignored.txt");
        std::fs::write(&ignored_path, "search_match in ignored").unwrap();
        std::fs::write(root.join(".gitignore"), "ignored.txt\n").unwrap();

        let q = query("search_match");
        let res_ignored = preview(
            &[root.clone()],
            &q,
            "replaced",
            &[ignored_path.to_string_lossy().into()],
            Arc::new(AtomicBool::new(false)),
        );
        assert!(res_ignored.is_err(), "Target in ignored path must be rejected");

        // 2. Target outside authorized workspace
        let other_dir = tempfile::tempdir().unwrap();
        let outside_path = other_dir.path().join("outside.txt");
        std::fs::write(&outside_path, "search_match in outside").unwrap();

        let res_outside = preview(
            &[root.clone()],
            &q,
            "replaced",
            &[outside_path.to_string_lossy().into()],
            Arc::new(AtomicBool::new(false)),
        );
        assert!(res_outside.is_err(), "Target outside roots must be rejected");
    }

    #[test]
    fn apply_fails_when_file_version_changes_after_preview() {
        let (_dir, root, _path) = fixture();
        let target = root.join("target.txt");
        std::fs::write(&target, "word 1\nword 2\n").unwrap();

        let q = query("word");
        let p = preview(
            &[root.clone()],
            &q,
            "replaced",
            &[target.to_string_lossy().into()],
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();

        assert_eq!(p.files.len(), 1);
        let original_version = p.files[0].version.clone();

        // Modify the target file on disk after preview (version changes)
        std::fs::write(&target, "word 1 modified\nword 2\n").unwrap();

        let req = ReplaceApply {
            query: q,
            replacement: "replaced".into(),
            path: target.to_string_lossy().into(),
            version: original_version,
            selected: vec![0, 1],
        };

        let res = apply(&[root.clone()], &req);
        assert!(res.is_err(), "Applying replacement when file version changed must fail");
        assert!(res.unwrap_err().contains("版本"));
    }
}

//! Presentation-only path rendering.
//!
//! Windows canonicalisation returns *verbatim* paths (`\\?\C:\...`). Those are
//! correct for system calls but wrong for anything a user reads, copies, pastes
//! into another program, or sees in a breadcrumb. Every path string that leaves
//! the native layer for the UI goes through here; the canonical `PathBuf` stays
//! untouched for authorization and I/O.

use std::path::Path;

/// Renders a path for the user: verbatim prefixes removed, nothing else changed.
pub fn display_path(path: &Path) -> String {
    display_text(&path.to_string_lossy())
}

/// Same normalisation for a path that is already a string (for example a value
/// read back from persisted preferences).
pub fn display_text(value: &str) -> String {
    // `\\?\UNC\server\share` is the verbatim spelling of `\\server\share`.
    if let Some(rest) = strip_prefix_ignore_case(value, r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    // `\\?\C:\dir\file` is the verbatim spelling of `C:\dir\file`.
    if let Some(rest) = strip_prefix_ignore_case(value, r"\\?\") {
        // Volume GUID paths (`\\?\Volume{...}`) have no drive-letter equivalent;
        // keep them untouched rather than producing something unusable.
        if rest.len() >= 2 && rest.as_bytes()[1] == b':' {
            return rest.to_string();
        }
        return value.to_string();
    }
    value.to_string()
}

fn strip_prefix_ignore_case<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    // Compare raw bytes: slicing a `str` at a byte index would panic when the
    // value starts with a multi-byte character (for example a CJK path).
    let value_bytes = value.as_bytes();
    let prefix_bytes = prefix.as_bytes();
    if value_bytes.len() < prefix_bytes.len() {
        return None;
    }
    if value_bytes[..prefix_bytes.len()].eq_ignore_ascii_case(prefix_bytes) {
        value.get(prefix_bytes.len()..)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn verbatim_drive_paths_lose_the_prefix() {
        assert_eq!(display_text(r"\\?\E:\code\lightEdit\design\icons\a.png"), r"E:\code\lightEdit\design\icons\a.png");
        assert_eq!(display_text(r"\\?\c:\temp"), r"c:\temp");
    }

    #[test]
    fn verbatim_unc_paths_become_normal_unc() {
        assert_eq!(display_text(r"\\?\UNC\server\share\file.md"), r"\\server\share\file.md");
        assert_eq!(display_text(r"\\?\unc\server\share"), r"\\server\share");
    }

    #[test]
    fn ordinary_paths_are_returned_unchanged() {
        for value in [r"C:\docs\a.md", r"\\server\share\b.md", "/home/user/c.md", "", "relative/path.md"] {
            assert_eq!(display_text(value), value);
        }
    }

    #[test]
    fn volume_guid_paths_are_not_mangled() {
        let value = r"\\?\Volume{4c1b02c1-0000-0000-0000-100000000000}\dir\a.md";
        assert_eq!(display_text(value), value, "a GUID volume has no drive-letter form");
    }

    #[test]
    fn unicode_and_spaces_survive() {
        assert_eq!(display_text(r"\\?\E:\中文 目录\文件.md"), r"E:\中文 目录\文件.md");
    }

    #[test]
    fn path_values_are_displayed_without_the_prefix() {
        let path = PathBuf::from(r"\\?\E:\code\lightEdit\README.md");
        assert_eq!(display_path(&path), r"E:\code\lightEdit\README.md");
    }
}

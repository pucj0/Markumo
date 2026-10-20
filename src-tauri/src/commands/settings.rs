use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::Mutex};
use tauri::Manager;
static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorSettings {
    theme: String,
    ui_font_size: u8,
    font_size: u8,
    font_family: String,
    word_wrap: bool,
    caret_animation: String,
    syntax_style: String,
    bracket_mode: String,
    show_outline: bool,
    outline_width: u16,
    indent_size: u8,
    use_tabs: bool,
    default_md_mode: String,
    live_toolbar: bool,
    markdown_typography: MarkdownTypography,
    markdown_clipboard: MarkdownClipboard,
    auto_save: bool,
    auto_check_updates: bool,
    auto_download_updates: bool,
    auto_save_delay: u32,
    tree_click_mode: String,
    auto_follow_active_file: bool,
    smart_expand: bool,
    compact_folders: bool,
    #[serde(deserialize_with = "deserialize_keymap_preset")]
    keymap_preset: String,
    image_rules: ImageRules,
    document_image_rules: BTreeMap<String, ImageRules>,
    #[serde(default = "legacy_settings_version")]
    settings_version: u8,
    #[serde(default = "legacy_shortcut_version")]
    shortcut_version: u8,
    custom_shortcuts: Vec<String>,
    shortcuts: BTreeMap<String, String>,
    file_modes: BTreeMap<String, String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct MarkdownTypography {
    width: u16,
    font_size: u8,
    font_family: String,
    line_height: f64,
    code_line_numbers: bool,
    code_wrap: bool,
    image_border: bool,
}
impl Default for MarkdownTypography {
    fn default() -> Self {
        Self {
            width: 860,
            font_size: 16,
            font_family: "system".into(),
            line_height: 1.6,
            code_line_numbers: true,
            code_wrap: false,
            image_border: true,
        }
    }
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct MarkdownClipboard {
    copy_markdown: bool,
    copy_whole_line: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageRules {
    location: String,
    custom_directory: String,
    relative: bool,
    dot_prefix: bool,
    escape: bool,
}
impl Default for ImageRules {
    fn default() -> Self {
        Self {
            location: "assets".into(),
            custom_directory: "./assets/".into(),
            relative: true,
            dot_prefix: true,
            escape: true,
        }
    }
}
fn valid_image_rules(rules: &ImageRules) -> bool {
    ["original", "sibling", "assets", "document", "custom"].contains(&rules.location.as_str())
        && rules.custom_directory.len() <= 4096
        && !rules.custom_directory.contains('\0')
}
impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            ui_font_size: 14,
            font_size: 14,
            font_family: "system".into(),
            word_wrap: false,
            caret_animation: "smooth".into(),
            syntax_style: "soft".into(),
            bracket_mode: "matching".into(),
            show_outline: false,
            outline_width: 240,
            indent_size: 4,
            use_tabs: false,
            default_md_mode: "live".into(),
            live_toolbar: true,
            markdown_typography: MarkdownTypography::default(),
            markdown_clipboard: MarkdownClipboard::default(),
            auto_save: false,
            auto_check_updates: true,
            auto_download_updates: false,
            auto_save_delay: 1500,
            tree_click_mode: "single".into(),
            auto_follow_active_file: false,
            smart_expand: true,
            compact_folders: false,
            keymap_preset: "markumo".into(),
            image_rules: ImageRules::default(),
            document_image_rules: BTreeMap::new(),
            settings_version: 6,
            shortcut_version: 4,
            custom_shortcuts: Vec::new(),
            shortcuts: BTreeMap::new(),
            file_modes: BTreeMap::new(),
        }
    }
}
/// Files written before settings provenance existed carry no version field.
/// They are read as version 1 so a legacy `autoSave` value is preserved rather
/// than replaced by the new opt-in default.
fn legacy_settings_version() -> u8 {
    1
}
fn legacy_shortcut_version() -> u8 {
    1
}
fn deserialize_keymap_preset<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<String, D::Error> {
    let value = String::deserialize(deserializer)?;
    Ok(if value == "lightedit" {
        "markumo".into()
    } else {
        value
    })
}
fn validate(settings: &EditorSettings) -> Result<(), String> {
    if !["off", "matching", "rainbow"].contains(&settings.bracket_mode.as_str()) {
        return Err("不支持的括号高亮模式".into());
    }
    if ![
        "soft",
        "standard",
        "vivid",
        "fleet",
        "fleet-dark",
        "fleet-light",
        "monokai-pro",
        "monokai-classic",
        "one-dark",
        "github-dark",
        "github-light",
    ]
    .contains(&settings.syntax_style.as_str())
    {
        return Err("不支持的编辑器配色".into());
    }
    let md = &settings.markdown_typography;
    if !(480..=1400).contains(&md.width)
        || !(12..=28).contains(&md.font_size)
        || !md.line_height.is_finite()
        || !(1.2..=2.4).contains(&md.line_height)
        || !["system", "serif", "mono"].contains(&md.font_family.as_str())
    {
        return Err("Markdown 排版设置超出支持范围".into());
    }
    if !["dark", "light", "system"].contains(&settings.theme.as_str())
        || !(12..=20).contains(&settings.ui_font_size)
        || !(160..=520).contains(&settings.outline_width)
        || !(10..=24).contains(&settings.font_size)
        || !["system", "consolas", "cascadia"].contains(&settings.font_family.as_str())
        || !["off", "quick", "smooth"].contains(&settings.caret_animation.as_str())
        || !(1..=8).contains(&settings.indent_size)
        || !(500..=10000).contains(&settings.auto_save_delay)
        || !["single", "double"].contains(&settings.tree_click_mode.as_str())
        || !["markumo", "fleet", "typora"].contains(&settings.keymap_preset.as_str())
        || !(1..=6).contains(&settings.settings_version)
        || !(1..=4).contains(&settings.shortcut_version)
        || settings.custom_shortcuts.len() > 128
        || settings.custom_shortcuts.iter().any(|id| id.len() > 64)
        || !["live", "source", "split"].contains(&settings.default_md_mode.as_str())
        || settings.file_modes.len() > 100
        || settings.shortcuts.len() > 128
        || !valid_image_rules(&settings.image_rules)
        || settings.document_image_rules.len() > 100
        || settings
            .document_image_rules
            .iter()
            .any(|(key, value)| key.len() > 16384 || !valid_image_rules(value))
    {
        return Err("首选项超出支持范围".into());
    }
    if settings.file_modes.iter().any(|(path, mode)| {
        path.len() > 16384 || !["live", "source", "split"].contains(&mode.as_str())
    }) || settings
        .shortcuts
        .iter()
        .any(|(id, key)| id.len() > 64 || key.len() > 64)
    {
        return Err("首选项字段无效".into());
    }
    Ok(())
}
fn load(path: &std::path::Path) -> Result<EditorSettings, String> {
    if !path.exists() {
        return Ok(EditorSettings::default());
    }
    if std::fs::metadata(path).map_err(|e| e.to_string())?.len() > 128 * 1024 {
        return Err("首选项文件过大".into());
    }
    let mut settings: EditorSettings =
        serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| format!("首选项损坏: {e}"))?;
    settings.syntax_style = match settings.syntax_style.as_str() {
        "fleet" | "fleet-dark" | "fleet-light" => "soft".into(),
        "monokai-pro" | "monokai-classic" => "vivid".into(),
        "one-dark" | "github-dark" | "github-light" => "standard".into(),
        _ => settings.syntax_style,
    };
    validate(&settings)?;
    Ok(settings)
}
fn save(path: &std::path::Path, settings: &EditorSettings) -> Result<(), String> {
    validate(settings)?;
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(path.parent().ok_or("首选项目录无效")?).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?;
    if bytes.len() > 128 * 1024 {
        return Err("首选项文件过大；旧设置仍保留".into());
    }
    let version = crate::files::disk_version(path).map_err(|e| e.message)?;
    let canonical = crate::files::checked_path(path, true).map_err(|e| e.message)?;
    crate::files::atomic::write_checked(&canonical, &bytes, version.as_deref())
        .map_err(|e| e.message)
}
#[tauri::command]
pub async fn load_editor_settings(app: tauri::AppHandle) -> Result<EditorSettings, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("editor-settings.json");
    tauri::async_runtime::spawn_blocking(move || load(&path))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn save_editor_settings(
    app: tauri::AppHandle,
    settings: EditorSettings,
) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("editor-settings.json");
    tauri::async_runtime::spawn_blocking(move || save(&path, &settings))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod branding_tests {
    use super::*;
    #[test]
    fn bracket_mode_defaults_validation_and_disk_round_trip() {
        let old: EditorSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(old.bracket_mode, "matching");
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        for mode in ["off", "matching", "rainbow"] {
            let settings: EditorSettings =
                serde_json::from_value(serde_json::json!({"bracketMode": mode})).unwrap();
            save(&path, &settings).unwrap();
            assert_eq!(load(&path).unwrap().bracket_mode, mode);
        }
        let bad: EditorSettings = serde_json::from_str(r#"{"bracketMode":"unknown"}"#).unwrap();
        assert!(validate(&bad).is_err());
    }
    #[test]
    fn syntax_style_defaults_validation_and_disk_round_trip() {
        let old: EditorSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(old.syntax_style, "soft");
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        for style in [
            "soft",
            "standard",
            "vivid",
            "fleet",
            "fleet-dark",
            "fleet-light",
            "monokai-pro",
            "monokai-classic",
            "one-dark",
            "github-dark",
            "github-light",
        ] {
            let settings: EditorSettings =
                serde_json::from_value(serde_json::json!({"syntaxStyle": style})).unwrap();
            save(&path, &settings).unwrap();
            let expected = match style {
                "fleet" | "fleet-dark" | "fleet-light" => "soft",
                "monokai-pro" | "monokai-classic" => "vivid",
                "one-dark" | "github-dark" | "github-light" => "standard",
                _ => style,
            };
            assert_eq!(load(&path).unwrap().syntax_style, expected);
        }
        let bad: EditorSettings = serde_json::from_str(r#"{"syntaxStyle":"unknown"}"#).unwrap();
        assert!(validate(&bad).is_err());
    }
    #[test]
    fn workspace_preferences_default_legacy_and_round_trip() {
        let old: EditorSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(old.tree_click_mode, "single");
        assert!(!old.auto_follow_active_file);
        assert!(old.smart_expand);
        assert!(!old.compact_folders);
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        for mode in ["single", "double"] {
            let settings: EditorSettings = serde_json::from_value(serde_json::json!({
                "treeClickMode": mode, "autoFollowActiveFile": true, "smartExpand": false, "compactFolders": true
            })).unwrap();
            save(&path, &settings).unwrap();
            let loaded = load(&path).unwrap();
            assert_eq!(loaded.tree_click_mode, mode);
            assert!(loaded.auto_follow_active_file);
            assert!(!loaded.smart_expand);
            assert!(loaded.compact_folders);
        }
        let legacy: EditorSettings = serde_json::from_str(r#"{"treeClickMode":"double"}"#).unwrap();
        assert_eq!(legacy.tree_click_mode, "double");
        assert!(!legacy.auto_follow_active_file);
        assert!(legacy.smart_expand);
        assert!(!legacy.compact_folders);
    }
    #[test]
    fn background_update_preferences_default_and_disk_round_trip() {
        let old: EditorSettings =
            serde_json::from_str(r#"{"theme":"dark","fontSize":18}"#).unwrap();
        assert!(old.auto_check_updates);
        assert!(!old.auto_download_updates);
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        let mut settings = old;
        settings.auto_check_updates = false;
        settings.auto_download_updates = true;
        save(&path, &settings).unwrap();
        let loaded = load(&path).unwrap();
        assert!(!loaded.auto_check_updates);
        assert!(loaded.auto_download_updates);
        assert_eq!(loaded.theme, "dark");
        assert_eq!(loaded.font_size, 18);
    }

    #[test]
    fn caret_animation_defaults_and_desktop_settings_round_trip() {
        let old: EditorSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(old.caret_animation, "smooth");
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("editor-settings.json");
        for mode in ["off", "quick", "smooth"] {
            // Includes the mode preference saved after clicking rich text.
            let input =
                serde_json::json!({"caretAnimation": mode, "fileModes": {"C:/README.md": "live"}});
            let settings: EditorSettings = serde_json::from_value(input).unwrap();
            save(&path, &settings).unwrap();
            let loaded = load(&path).unwrap();
            assert_eq!(loaded.caret_animation, mode);
            assert_eq!(loaded.file_modes["C:/README.md"], "live");
            assert_eq!(
                serde_json::to_value(loaded).unwrap()["caretAnimation"],
                mode
            );
        }
        let invalid: EditorSettings =
            serde_json::from_str(r#"{"caretAnimation":"invalid"}"#).unwrap();
        assert!(validate(&invalid).is_err());
        assert!(serde_json::from_str::<EditorSettings>(r#"{"caretAnimation":null}"#).is_err());
    }

    #[test]
    fn full_shortcut_catalog_and_explicit_unbinding_survive_disk_round_trip() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("editor-settings.json");
        for preset in ["markumo", "fleet", "typora"] {
            let input = serde_json::json!({
                "keymapPreset":preset,"shortcutVersion":4,"customShortcuts":["table","close-pane"],
                "shortcuts":{"table":"","close-pane":"Mod+Alt+W","heading-6":"Mod+6","move-line-up":"Alt+ArrowUp"},
                "caretAnimation":"quick","autoDownloadUpdates":true
            });
            let settings: EditorSettings = serde_json::from_value(input).unwrap();
            save(&path, &settings).unwrap();
            let loaded = load(&path).unwrap();
            assert_eq!(loaded.shortcut_version, 4);
            assert_eq!(loaded.keymap_preset, preset);
            assert_eq!(loaded.shortcuts["table"], "");
            assert_eq!(loaded.shortcuts["close-pane"], "Mod+Alt+W");
            assert_eq!(loaded.custom_shortcuts, vec!["table", "close-pane"]);
            assert_eq!(loaded.caret_animation, "quick");
            assert!(loaded.auto_download_updates);
        }
    }

    #[test]
    fn outline_width_defaults_and_saved_preferences() {
        let old: EditorSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(old.outline_width, 240);
        let settings: EditorSettings = serde_json::from_str(r#"{"outlineWidth":360}"#).unwrap();
        validate(&settings).unwrap();
        assert_eq!(serde_json::to_value(settings).unwrap()["outlineWidth"], 360);
        for width in [0, 159, 521] {
            let invalid: EditorSettings =
                serde_json::from_str(&format!(r#"{{"outlineWidth":{width}}}"#)).unwrap();
            assert!(validate(&invalid).is_err());
        }
    }

    #[test]
    fn rich_clipboard_defaults_and_preferences_round_trip() {
        let old: EditorSettings = serde_json::from_str("{}").unwrap();
        assert!(!old.markdown_clipboard.copy_markdown);
        assert!(!old.markdown_clipboard.copy_whole_line);
        let settings: EditorSettings = serde_json::from_str(
            r#"{"markdownClipboard":{"copyMarkdown":false,"copyWholeLine":true}}"#,
        )
        .unwrap();
        validate(&settings).unwrap();
        let value = serde_json::to_value(settings).unwrap();
        assert_eq!(value["markdownClipboard"]["copyMarkdown"], false);
        assert_eq!(value["markdownClipboard"]["copyWholeLine"], true);
        assert!(serde_json::from_str::<EditorSettings>(
            r#"{"markdownClipboard":{"copyMarkdown":"false"}}"#
        )
        .is_err());
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        // Legacy versions (1, 5) and current version (6) preserve explicitly saved copyMarkdown values (true or false).
        // If copyMarkdown or markdownClipboard is omitted, it defaults to false.
        for version in [1, 5, 6] {
            let settings: EditorSettings = serde_json::from_value(serde_json::json!({
                "settingsVersion": version,
                "markdownClipboard": {"copyMarkdown": true, "copyWholeLine": true}
            }))
            .unwrap();
            save(&path, &settings).unwrap();
            let loaded = load(&path).unwrap();
            assert!(loaded.markdown_clipboard.copy_markdown);
            assert!(loaded.markdown_clipboard.copy_whole_line);
        }
        for version in [1, 5, 6] {
            let settings: EditorSettings = serde_json::from_value(serde_json::json!({
                "settingsVersion": version,
                "markdownClipboard": {"copyMarkdown": false, "copyWholeLine": true}
            }))
            .unwrap();
            save(&path, &settings).unwrap();
            let loaded = load(&path).unwrap();
            assert!(!loaded.markdown_clipboard.copy_markdown);
            assert!(loaded.markdown_clipboard.copy_whole_line);
        }
        for version in [1, 5, 6] {
            let settings: EditorSettings = serde_json::from_value(serde_json::json!({
                "settingsVersion": version,
                "markdownClipboard": {"copyWholeLine": true}
            }))
            .unwrap();
            save(&path, &settings).unwrap();
            let loaded = load(&path).unwrap();
            assert!(!loaded.markdown_clipboard.copy_markdown);
            assert!(loaded.markdown_clipboard.copy_whole_line);
        }
        for version in [1, 5, 6] {
            let settings: EditorSettings = serde_json::from_value(serde_json::json!({
                "settingsVersion": version
            }))
            .unwrap();
            save(&path, &settings).unwrap();
            let loaded = load(&path).unwrap();
            assert!(!loaded.markdown_clipboard.copy_markdown);
            assert!(!loaded.markdown_clipboard.copy_whole_line);
        }
    }

    #[test]
    fn old_preset_is_read_but_only_markumo_is_serialized() {
        let settings: EditorSettings =
            serde_json::from_str(r#"{"keymapPreset":"lightedit","fontSize":19,"autoSave":true}"#)
                .unwrap();
        validate(&settings).unwrap();
        let value = serde_json::to_value(&settings).unwrap();
        assert_eq!(value["keymapPreset"], "markumo");
        assert_eq!(value["fontSize"], 19);
        assert_eq!(value["autoSave"], true);
        assert_eq!(EditorSettings::default().keymap_preset, "markumo");
    }

    /// The web reader measures `customDirectory` in UTF-8 bytes and rejects NUL;
    /// these are the same vectors `settings-keybindings-regression.mjs` asserts, so
    /// a divergence in either implementation fails a real behaviour check.
    #[test]
    fn image_directory_limit_is_utf8_bytes_and_rejects_nul() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        let ascii_at = "a".repeat(4096);
        let ascii_over = "a".repeat(4097);
        let cjk = "中".repeat(1365); // 4095 bytes, 1365 UTF-16 code units
        let cjk_at = format!("{cjk}a");
        let cjk_over = format!("{cjk}ab");
        let emoji = "😀".repeat(1024); // 4096 bytes, 2048 UTF-16 code units
        let emoji_over = format!("{emoji}a");
        // 4200 bytes but only 1400 UTF-16 code units: a code-unit check accepts it.
        let units_bypass = "中".repeat(1400);
        for (value, accepted) in [
            ("assets/中文", true),
            (ascii_at.as_str(), true),
            (ascii_over.as_str(), false),
            (cjk_at.as_str(), true),
            (cjk_over.as_str(), false),
            (emoji.as_str(), true),
            (emoji_over.as_str(), false),
            (units_bypass.as_str(), false),
            ("./assets/\u{0}x", false),
        ] {
            let mut settings = EditorSettings::default();
            settings.image_rules.custom_directory = value.to_string();
            assert_eq!(
                save(&path, &settings).is_ok(),
                accepted,
                "customDirectory bytes={}",
                value.len()
            );
        }
    }

    #[test]
    fn per_document_map_keys_are_capped_at_16384_utf8_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        let ascii_at = "p".repeat(16384);
        let ascii_over = "p".repeat(16385);
        let cjk_at = format!("{}p", "中".repeat(5461)); // 16383 + 1 bytes
        let cjk_over = format!("{cjk_at}pp");
        let emoji_at = "😀".repeat(4096); // 16384 bytes
        let emoji_over = format!("{emoji_at}a");
        for (key, accepted) in [
            (ascii_at.as_str(), true),
            (ascii_over.as_str(), false),
            (cjk_at.as_str(), true),
            (cjk_over.as_str(), false),
            (emoji_at.as_str(), true),
            (emoji_over.as_str(), false),
        ] {
            let mut modes = EditorSettings::default();
            modes
                .file_modes
                .insert(key.to_string(), "source".to_string());
            assert_eq!(
                save(&path, &modes).is_ok(),
                accepted,
                "fileModes key bytes={}",
                key.len()
            );
            let mut rules = EditorSettings::default();
            rules
                .document_image_rules
                .insert(key.to_string(), ImageRules::default());
            assert_eq!(
                save(&path, &rules).is_ok(),
                accepted,
                "documentImageRules key bytes={}",
                key.len()
            );
        }
    }

    /// `__proto__` and friends are ordinary map keys for serde; the desktop side
    /// must round-trip them verbatim instead of dropping user data.
    #[test]
    fn reserved_looking_keys_round_trip_as_plain_map_keys() {
        let settings: EditorSettings = serde_json::from_str(
            r#"{"fileModes":{"__proto__":"source","constructor":"live","prototype":"split"},
                "documentImageRules":{"__proto__":{"location":"sibling"}}}"#,
        )
        .unwrap();
        validate(&settings).unwrap();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        save(&path, &settings).unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded.file_modes.len(), 3);
        assert_eq!(
            loaded.file_modes.get("__proto__").map(String::as_str),
            Some("source")
        );
        assert_eq!(loaded.document_image_rules.len(), 1);
        let value = serde_json::to_value(&loaded).unwrap();
        assert_eq!(value["fileModes"]["constructor"], "live");
        assert_eq!(
            value["documentImageRules"]["__proto__"]["location"],
            "sibling"
        );
    }
}

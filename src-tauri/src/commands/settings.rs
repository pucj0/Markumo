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
    show_outline: bool,
    indent_size: u8,
    use_tabs: bool,
    default_md_mode: String,
    markdown_typography: MarkdownTypography,
    auto_save: bool,
    auto_save_delay: u32,
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
    width: u16, font_size: u8, font_family: String, line_height: f64,
    code_line_numbers: bool, code_wrap: bool,
}
impl Default for MarkdownTypography {
    fn default() -> Self { Self { width: 860, font_size: 16, font_family: "system".into(), line_height: 1.6, code_line_numbers: true, code_wrap: false } }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageRules {
    location: String, custom_directory: String, relative: bool, dot_prefix: bool, escape: bool,
}
impl Default for ImageRules {
    fn default()->Self { Self{location:"assets".into(),custom_directory:"./assets/".into(),relative:true,dot_prefix:true,escape:true} }
}
fn valid_image_rules(rules: &ImageRules)->bool {
    ["original","sibling","assets","document","custom"].contains(&rules.location.as_str()) && rules.custom_directory.len()<=4096 && !rules.custom_directory.contains('\0')
}
impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            ui_font_size: 14,
            font_size: 14,
            font_family: "system".into(),
            word_wrap: false,
            show_outline: false,
            indent_size: 2,
            use_tabs: false,
            default_md_mode: "live".into(),
            markdown_typography: MarkdownTypography::default(),
            auto_save: false,
            auto_save_delay: 1500,
            image_rules: ImageRules::default(),
            document_image_rules: BTreeMap::new(),
            settings_version: 5,
            shortcut_version: 3,
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
fn validate(settings: &EditorSettings) -> Result<(), String> {
    let md = &settings.markdown_typography;
    if !(480..=1400).contains(&md.width) || !(12..=28).contains(&md.font_size)
        || !md.line_height.is_finite() || !(1.2..=2.4).contains(&md.line_height)
        || !["system", "serif", "mono"].contains(&md.font_family.as_str()) {
        return Err("Markdown 排版设置超出支持范围".into());
    }
    if !["dark", "light", "system"].contains(&settings.theme.as_str())
        || !(12..=20).contains(&settings.ui_font_size)
        || !(10..=24).contains(&settings.font_size)
        || !["system", "consolas", "cascadia"].contains(&settings.font_family.as_str())
        || !(1..=8).contains(&settings.indent_size)
        || !(500..=10000).contains(&settings.auto_save_delay)
        || !(1..=5).contains(&settings.settings_version)
        || !(1..=3).contains(&settings.shortcut_version)
        || settings.custom_shortcuts.len() > 32
        || settings.custom_shortcuts.iter().any(|id| id.len()>64)
        || !["live", "source", "split"].contains(&settings.default_md_mode.as_str())
        || settings.file_modes.len() > 100
        || settings.shortcuts.len() > 32
        || !valid_image_rules(&settings.image_rules)
        || settings.document_image_rules.len()>100
        || settings.document_image_rules.iter().any(|(key,value)|key.len()>16384||!valid_image_rules(value))
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
    let settings = serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("首选项损坏: {e}"))?;
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
mod tests {
    #[test]
    fn ui_typography_migrates_v4_and_survives_restart_without_changing_document_fonts() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, br#"{"settingsVersion":4,"fontSize":17,"autoSave":true,"theme":"dark","markdownTypography":{"fontSize":19}}"#).unwrap();
        let mut settings = super::load(&path).unwrap();
        assert_eq!(settings.ui_font_size, 14);
        assert_eq!(settings.font_size, 17);
        assert_eq!(settings.markdown_typography.font_size, 19);
        assert!(settings.auto_save);
        settings.ui_font_size = 16;
        settings.settings_version = 5;
        super::save(&path, &settings).unwrap();
        let loaded = super::load(&path).unwrap();
        assert_eq!(loaded.ui_font_size, 16);
        assert_eq!(loaded.font_size, 17);
        assert_eq!(loaded.markdown_typography.font_size, 19);
        assert!(loaded.auto_save);
        for invalid in [0, 11, 21, 255] {
            settings.ui_font_size = invalid;
            assert!(super::save(&path, &settings).is_err());
            assert_eq!(super::load(&path).unwrap().ui_font_size, 16);
        }
    }
    #[test]
    fn markdown_typography_roundtrips_and_rejects_invalid_values_without_enabling_autosave() {
        let mut settings = super::EditorSettings::default();
        assert!(!settings.auto_save);
        assert_eq!(settings.markdown_typography.width, 860);
        settings.markdown_typography.width = 720;
        settings.markdown_typography.code_wrap = true;
        let roundtrip: super::EditorSettings = serde_json::from_slice(&serde_json::to_vec(&settings).unwrap()).unwrap();
        assert_eq!(roundtrip.markdown_typography.width, 720);
        assert!(roundtrip.markdown_typography.code_wrap);
        assert!(super::validate(&roundtrip).is_ok());
        settings.markdown_typography.line_height = f64::NAN;
        assert!(super::validate(&settings).is_err());
    }
    #[test]
    fn image_rules_defaults_and_document_overrides_roundtrip_without_touching_markdown() {
        let dir=tempfile::tempdir().unwrap();let path=dir.path().join("settings.json");
        let mut settings=super::load(&path).unwrap();assert_eq!(settings.image_rules.location,"assets");
        settings.image_rules.location="original".into();
        let mut rule=super::ImageRules::default();rule.location="custom".into();rule.custom_directory="./${filename}.assets/中文 图片".into();
        settings.document_image_rules.insert("c:/中文.md".into(),rule);
        super::save(&path,&settings).unwrap();let loaded=super::load(&path).unwrap();
        assert_eq!(loaded.image_rules.location,"original");assert_eq!(loaded.document_image_rules["c:/中文.md"].custom_directory,"./${filename}.assets/中文 图片");
        settings.image_rules.location="upload".into();assert!(super::save(&path,&settings).is_err());
    }
    #[test]
    fn shortcut_version_distinguishes_legacy_from_explicit_preferences() {
        let legacy: super::EditorSettings = serde_json::from_str(r#"{"theme":"light"}"#).unwrap();
        assert_eq!(legacy.shortcut_version, 1);
        let current = super::EditorSettings::default();
        assert_eq!(current.shortcut_version, 3);
        let roundtrip: super::EditorSettings =
            serde_json::from_slice(&serde_json::to_vec(&current).unwrap()).unwrap();
        assert_eq!(roundtrip.shortcut_version, 3);
    }
    #[test]
    fn automatic_save_defaults_and_explicit_preferences_are_validated_and_persisted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        // A fresh installation never enables automatic save.
        let fresh = super::load(&path).unwrap();
        assert!(!fresh.auto_save);
        assert_eq!(fresh.settings_version, 5);
        // A legacy file without provenance keeps its stored value as version 1.
        std::fs::write(&path, br#"{"theme":"light"}"#).unwrap();
        let mut settings = super::load(&path).unwrap();
        assert_eq!(settings.settings_version, 1);
        assert!(!settings.auto_save);
        assert_eq!(settings.auto_save_delay, 1500);
        settings.auto_save = false;
        settings.auto_save_delay = 3000;
        super::save(&path, &settings).unwrap();
        assert!(!super::load(&path).unwrap().auto_save);
        settings.auto_save_delay = 0;
        assert!(super::save(&path, &settings).is_err());
        assert_eq!(super::load(&path).unwrap().auto_save_delay, 3000);
        settings.auto_save_delay = 3000;
        settings.settings_version = 6;
        assert!(super::save(&path, &settings).is_err());
        assert_eq!(super::load(&path).unwrap().settings_version, 1);
    }
    #[test]
    fn legacy_explicit_auto_save_survives_migration_while_new_installs_stay_off() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        // Ambiguous legacy `true` is preserved byte-for-byte, not overwritten.
        std::fs::write(&path, br#"{"theme":"system","autoSave":true,"autoSaveDelay":2000}"#).unwrap();
        let legacy = super::load(&path).unwrap();
        assert!(legacy.auto_save);
        assert_eq!(legacy.settings_version, 1);
        // Explicitly disabled legacy value is also preserved.
        std::fs::write(&path, br#"{"theme":"system","autoSave":false}"#).unwrap();
        assert!(!super::load(&path).unwrap().auto_save);
        // New settings objects written by this version stay off unless enabled.
        let current = super::EditorSettings::default();
        assert!(!current.auto_save);
        assert_eq!(current.settings_version, 5);
    }
    #[test]
    fn theme_preferences_survive_restart_and_invalid_theme_preserves_previous_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        assert_eq!(super::load(&path).unwrap().theme, "system");
        // Older files only stored an explicit theme; serde defaults fill other fields.
        std::fs::write(&path, br#"{"theme":"dark"}"#).unwrap();
        assert_eq!(super::load(&path).unwrap().theme, "dark");
        let mut settings = super::load(&path).unwrap();
        for theme in ["light", "dark", "system"] {
            settings.theme = theme.into();
            super::save(&path, &settings).unwrap();
            assert_eq!(super::load(&path).unwrap().theme, theme);
        }
        settings.theme = "invalid".into();
        assert!(super::save(&path, &settings).is_err());
        assert_eq!(super::load(&path).unwrap().theme, "system");
    }

    #[test]
    fn settings_survive_service_restart_and_reject_invalid_values() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut settings = super::load(&path).unwrap();
        settings.font_size = 17;
        settings.indent_size = 4;
        settings.word_wrap = true;
        settings
            .file_modes
            .insert("C:/example.md".into(), "source".into());
        super::save(&path, &settings).unwrap();
        let reloaded = super::load(&path).unwrap();
        assert_eq!(reloaded.font_size, 17);
        assert_eq!(reloaded.indent_size, 4);
        assert!(reloaded.word_wrap);
        settings.font_size = 255;
        assert!(super::save(&path, &settings).is_err());
        assert_eq!(super::load(&path).unwrap().font_size, 17);
        std::fs::write(&path, b"corrupt").unwrap();
        assert!(super::load(&path).is_err());
    }
}

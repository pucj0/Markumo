use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::Mutex};
use tauri::Manager;
static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorSettings {
    theme: String,
    font_size: u8,
    font_family: String,
    word_wrap: bool,
    show_outline: bool,
    indent_size: u8,
    use_tabs: bool,
    default_md_mode: String,
    auto_save: bool,
    auto_save_delay: u32,
    #[serde(default = "legacy_shortcut_version")]
    shortcut_version: u8,
    custom_shortcuts: Vec<String>,
    shortcuts: BTreeMap<String, String>,
    file_modes: BTreeMap<String, String>,
}
impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            font_size: 14,
            font_family: "system".into(),
            word_wrap: false,
            show_outline: false,
            indent_size: 2,
            use_tabs: false,
            default_md_mode: "live".into(),
            auto_save: true,
            auto_save_delay: 1500,
            shortcut_version: 3,
            custom_shortcuts: Vec::new(),
            shortcuts: BTreeMap::new(),
            file_modes: BTreeMap::new(),
        }
    }
}
fn legacy_shortcut_version() -> u8 {
    1
}
fn validate(settings: &EditorSettings) -> Result<(), String> {
    if !["dark", "light", "system"].contains(&settings.theme.as_str())
        || !(10..=24).contains(&settings.font_size)
        || !["system", "consolas", "cascadia"].contains(&settings.font_family.as_str())
        || !(1..=8).contains(&settings.indent_size)
        || !(500..=10000).contains(&settings.auto_save_delay)
        || !(1..=3).contains(&settings.shortcut_version)
        || settings.custom_shortcuts.len() > 32
        || settings.custom_shortcuts.iter().any(|id| id.len()>64)
        || !["live", "source", "split"].contains(&settings.default_md_mode.as_str())
        || settings.file_modes.len() > 100
        || settings.shortcuts.len() > 32
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
        std::fs::write(&path, br#"{"theme":"light"}"#).unwrap();
        let mut settings = super::load(&path).unwrap();
        assert!(settings.auto_save);
        assert_eq!(settings.auto_save_delay, 1500);
        settings.auto_save = false;
        settings.auto_save_delay = 3000;
        super::save(&path, &settings).unwrap();
        assert!(!super::load(&path).unwrap().auto_save);
        settings.auto_save_delay = 0;
        assert!(super::save(&path, &settings).is_err());
        assert_eq!(super::load(&path).unwrap().auto_save_delay, 3000);
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

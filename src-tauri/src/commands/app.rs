#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn ensure_update_window(window: tauri::WebviewWindow) -> Result<(), String> {
    use tauri::Manager;
    if window.app_handle().webview_windows().len() != 1 {
        return Err("请先保存修改并关闭其他 Markumo 窗口，再安装更新。".into());
    }
    Ok(())
}

fn validated_external_url(raw: &str) -> Result<String, String> {
    let url = tauri::Url::parse(raw).map_err(|_| "无效链接".to_string())?;
    if !["http", "https"].contains(&url.scheme())
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("仅允许不含账号信息的 HTTP/HTTPS 链接".into());
    }
    Ok(url.into())
}

#[tauri::command]
pub async fn open_external_link(url: String) -> Result<(), String> {
    let url = validated_external_url(&url)?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        let mut command = {
            use std::os::windows::process::CommandExt;
            let system = std::env::var_os("SystemRoot").ok_or("找不到 Windows 系统目录")?;
            let mut command = std::process::Command::new(
                std::path::PathBuf::from(system).join("System32/rundll32.exe"),
            );
            command
                .args(["url.dll,FileProtocolHandler", &url])
                .creation_flags(0x08000000);
            command
        };
        #[cfg(target_os = "macos")]
        let mut command = {
            let mut command = std::process::Command::new("open");
            command.arg(&url);
            command
        };
        #[cfg(all(not(windows), not(target_os = "macos")))]
        let mut command = {
            let mut command = std::process::Command::new("xdg-open");
            command.arg(&url);
            command
        };
        let status = command.status().map_err(|e| format!("打开链接失败: {e}"))?;
        if !status.success() {
            return Err("系统浏览器未能打开链接".into());
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

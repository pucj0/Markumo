#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
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

#[cfg(test)]
mod tests {
    #[test]
    fn only_safe_web_links_are_accepted() {
        for url in [
            "javascript:alert(1)",
            "file:///C:/secret",
            "data:text/html,hello",
            "https://user:password@example.com",
            "not a url",
        ] {
            assert!(super::validated_external_url(url).is_err());
        }
        assert_eq!(
            super::validated_external_url("https://example.com/a").unwrap(),
            "https://example.com/a"
        );
    }
}

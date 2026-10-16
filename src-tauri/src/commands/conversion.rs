use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::mpsc,
    time::Duration,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindow, WebviewWindowBuilder, WebviewUrl};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PandocStatus {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfPrintOptions {
    pub paper_size: Option<String>,     // "A4" | "Letter"
    pub orientation: Option<String>,    // "portrait" | "landscape"
    pub margins: Option<String>,        // "default" | "compact" | "loose"
    pub print_background: Option<bool>,
}

/// Discovers Pandoc executable from PATH or standard Windows install locations.
pub fn find_pandoc_path() -> Option<PathBuf> {
    // 1. Check if 'pandoc' is in PATH
    if let Ok(output) = Command::new("pandoc").arg("--version").output() {
        if output.status.success() {
            return Some(PathBuf::from("pandoc"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        // 2. Check standard Windows installation paths
        let candidates = [
            std::env::var("ProgramFiles").map(|p| PathBuf::from(p).join("Pandoc").join("pandoc.exe")),
            std::env::var("ProgramFiles(x86)").map(|p| PathBuf::from(p).join("Pandoc").join("pandoc.exe")),
            std::env::var("LOCALAPPDATA").map(|p| PathBuf::from(p).join("Pandoc").join("pandoc.exe")),
            std::env::var("APPDATA").map(|p| PathBuf::from(p).join("Pandoc").join("pandoc.exe")),
        ];

        for candidate in candidates.into_iter().flatten() {
            if candidate.exists() {
                if let Ok(output) = Command::new(&candidate).arg("--version").output() {
                    if output.status.success() {
                        return Some(candidate);
                    }
                }
            }
        }
    }

    None
}

#[tauri::command]
pub async fn detect_pandoc() -> Result<PandocStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let exe = match find_pandoc_path() {
            Some(p) => p,
            None => {
                return Ok(PandocStatus {
                    available: false,
                    version: None,
                    path: None,
                });
            }
        };

        let output = Command::new(&exe)
            .arg("--version")
            .output()
            .map_err(|e| format!("执行 Pandoc 失败: {e}"))?;

        if !output.status.success() {
            return Ok(PandocStatus {
                available: false,
                version: None,
                path: None,
            });
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        // First line is like "pandoc 3.8.3" or "pandoc.exe 3.8.3"
        let first_line = stdout.lines().next().unwrap_or("").trim();
        let version = first_line
            .split_whitespace()
            .nth(1)
            .unwrap_or(first_line)
            .to_string();

        Ok(PandocStatus {
            available: true,
            version: Some(version),
            path: Some(exe.to_string_lossy().to_string()),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn export_save_dialog(
    app: AppHandle,
    window: WebviewWindow,
    default_name: String,
    format: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_file_name(default_name)
            .set_title("导出文档");

        match format.to_ascii_lowercase().as_str() {
            "pdf" => {
                dialog = dialog.add_filter("PDF 文档 (*.pdf)", &["pdf"]);
            }
            "html" => {
                dialog = dialog.add_filter("HTML 网页 (*.html; *.htm)", &["html", "htm"]);
            }
            "docx" => {
                dialog = dialog.add_filter("Word 文档 (*.docx)", &["docx"]);
            }
            "png" => {
                dialog = dialog.add_filter("PNG 图像 (*.png)", &["png"]);
            }
            _ => {
                dialog = dialog.add_filter("所有文件 (*.*)", &["*"]);
            }
        }

        let selected = dialog.blocking_save_file();
        Ok(selected.and_then(|file_path| file_path.into_path().ok().map(|p| p.to_string_lossy().to_string())))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn import_open_dialog(
    app: AppHandle,
    window: WebviewWindow,
    format: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("导入文档");

        match format.to_ascii_lowercase().as_str() {
            "html" => {
                dialog = dialog.add_filter("HTML 网页 (*.html; *.htm)", &["html", "htm"]);
            }
            "docx" => {
                dialog = dialog.add_filter("Word 文档 (*.docx)", &["docx"]);
            }
            _ => {
                dialog = dialog.add_filter("支持的文档 (*.html; *.htm; *.docx)", &["html", "htm", "docx"]);
            }
        }

        let selected = dialog.blocking_pick_file();
        Ok(selected.and_then(|file_path| file_path.into_path().ok().map(|p| p.to_string_lossy().to_string())))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_binary_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = PathBuf::from(&path);
        let parent = target.parent().ok_or_else(|| "无效的目标路径".to_string())?;
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }

        // Write to temporary file first for atomic replacement
        let temp_path = parent.join(format!(
            ".markumo-export-{}.tmp",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));

        std::fs::write(&temp_path, &bytes).map_err(|e| format!("写入临时文件失败: {e}"))?;

        if let Err(e) = std::fs::rename(&temp_path, &target) {
            // Fallback for Windows cross-volume or existing target
            let _ = std::fs::copy(&temp_path, &target);
            let _ = std::fs::remove_file(&temp_path);
            if !target.exists() {
                return Err(format!("保存文件失败: {e}"));
            }
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pandoc_export_docx(
    markdown_content: String,
    output_docx_path: String,
    resource_dir: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let pandoc_exe = find_pandoc_path().ok_or_else(|| "未检测到可用的 Pandoc，请先安装 Pandoc。".to_string())?;

        let temp_dir = tempfile::tempdir().map_err(|e| format!("创建临时工作目录失败: {e}"))?;
        let temp_md = temp_dir.path().join("input.md");
        std::fs::write(&temp_md, &markdown_content).map_err(|e| format!("写入 Markdown 临时文件失败: {e}"))?;

        let mut cmd = Command::new(&pandoc_exe);
        cmd.arg("-f").arg("gfm")
            .arg("-t").arg("docx")
            .arg("--standalone")
            .arg("-o").arg(&output_docx_path)
            .arg(&temp_md);

        if let Some(ref res_dir) = resource_dir {
            cmd.arg("--resource-path").arg(res_dir);
        }

        let output = cmd.output().map_err(|e| format!("调用 Pandoc 导出 Word 失败: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Pandoc 导出失败: {stderr}"));
        }

        if !Path::new(&output_docx_path).exists() {
            return Err("Pandoc 未生成预期的 Word 文件。".to_string());
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pandoc_import_docx(
    input_docx_path: String,
    target_md_path: String,
    media_dir: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let pandoc_exe = find_pandoc_path().ok_or_else(|| "未检测到可用的 Pandoc，请先安装 Pandoc。".to_string())?;
        let input_path = PathBuf::from(&input_docx_path);
        if !input_path.exists() {
            return Err("指定的 Word 文档不存在。".to_string());
        }

        let mut cmd = Command::new(&pandoc_exe);
        cmd.arg("-f").arg("docx")
            .arg("-t").arg("gfm")
            .arg("--wrap=none")
            .arg("--extract-media").arg(&media_dir)
            .arg("-o").arg(&target_md_path)
            .arg(&input_docx_path);

        let output = cmd.output().map_err(|e| format!("调用 Pandoc 导入 Word 失败: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Pandoc 导入失败: {stderr}"));
        }

        let md_content = std::fs::read_to_string(&target_md_path)
            .map_err(|e| format!("读取导入的 Markdown 结果失败: {e}"))?;

        Ok(md_content)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn print_to_pdf(
    app: AppHandle,
    html_content: String,
    output_pdf_path: String,
    _options: Option<PdfPrintOptions>,
) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::PrintToPdfCompletedHandler;
    use windows_core::Interface;

    // 1. Write HTML to temporary file
    let temp_dir = tempfile::tempdir().map_err(|e| format!("创建临时打印目录失败: {e}"))?;
    let temp_html = temp_dir.path().join("print.html");
    std::fs::write(&temp_html, &html_content).map_err(|e| format!("写入临时打印文档失败: {e}"))?;

    let file_url = format!("file:///{}", temp_html.to_string_lossy().replace('\\', "/"));
    let window_label = format!("pdf-print-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());

    // 2. Build offscreen WebviewWindow
    let window = WebviewWindowBuilder::new(
        &app,
        &window_label,
        WebviewUrl::External(url::Url::parse(&file_url).map_err(|e| e.to_string())?),
    )
    .visible(false)
    .decorations(false)
    .title("Markumo PDF Export")
    .build()
    .map_err(|e| format!("创建打印容器失败: {e}"))?;

    // 3. Wait for WebView navigation and print to PDF via WebView2
    let (tx, rx) = mpsc::channel();
    let tx_clone = tx.clone();
    let output_pdf = output_pdf_path.clone();

    // Give time for resources/fonts to settle, then invoke PrintToPdf
    std::thread::spawn(move || {
        // Wait 1.2s for math/fonts/images to layout in the hidden webview
        std::thread::sleep(Duration::from_millis(1200));

        let print_res = window.with_webview(move |wv| {
            let controller = wv.controller();
            let core = match unsafe { controller.CoreWebView2() } {
                Ok(c) => c,
                Err(e) => {
                    let _ = tx_clone.send(Err(format!("获取 CoreWebView2 失败: {e}")));
                    return;
                }
            };
            let core7: ICoreWebView2_7 = match core.cast() {
                Ok(c7) => c7,
                Err(e) => {
                    let _ = tx_clone.send(Err(format!("CoreWebView2_7 不可用 (需要 WebView2 运行时更新): {e}")));
                    return;
                }
            };

            let wide_path: Vec<u16> = output_pdf.encode_utf16().chain(std::iter::once(0)).collect();
            let pcwstr = windows_core::PCWSTR::from_raw(wide_path.as_ptr());

            let tx_done = tx_clone.clone();
            let handler = PrintToPdfCompletedHandler::create(Box::new(move |error_code, is_successful| {
                if is_successful {
                    let _ = tx_done.send(Ok(()));
                } else {
                    let _ = tx_done.send(Err(format!("WebView2 导出 PDF 失败，错误码: {:?}", error_code)));
                }
                Ok(())
            }));

            let print_call = unsafe {
                core7.PrintToPdf(pcwstr, None, Some(&handler))
            };

            if let Err(e) = print_call {
                let _ = tx_clone.send(Err(format!("调用 PrintToPdf 失败: {e}")));
            }
        });

        if let Err(e) = print_res {
            let _ = tx.send(Err(format!("with_webview 执行失败: {e}")));
        }
    });

    let result = rx.recv_timeout(Duration::from_secs(30))
        .map_err(|_| "导出 PDF 超时 (30秒)。".to_string())?;

    // Destroy the hidden print window
    if let Some(w) = app.get_webview_window(&window_label) {
        let _ = w.destroy();
    }

    result
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn print_to_pdf(
    _app: AppHandle,
    _html_content: String,
    _output_pdf_path: String,
    _options: Option<PdfPrintOptions>,
) -> Result<(), String> {
    Err("当前平台暂未实现原生 PDF 导出能力。".to_string())
}

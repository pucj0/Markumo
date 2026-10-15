use std::{path::PathBuf, sync::{Arc, Mutex}};
use tauri::{AppHandle, State, Window};
use tauri_plugin_dialog::DialogExt;
use crate::files::{FileError, FileMetadata, FileService, Layout, OpenBatch, OpenFile, Preferences, Result, SaveTarget};

pub type FileStore = Arc<Mutex<FileService>>;

async fn operate<T: Send + 'static>(store: FileStore, owner: String, action: impl FnOnce(&mut FileService) -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut service = store.lock().map_err(|_| FileError::new("state", "文件服务不可用，编辑内容仍保留。"))?;
        service.set_owner(&owner);
        action(&mut service)
    }).await.map_err(|error| FileError::new("task", &error.to_string()))?
}

#[tauri::command]
pub async fn open_dialog(app: AppHandle, window: Window, store: State<'_, FileStore>, encoding: Option<String>) -> Result<OpenBatch> {
    let owner=window.label().to_owned();
    let paths = tauri::async_runtime::spawn_blocking(move || app.dialog().file().set_parent(&window).blocking_pick_files())
        .await.map_err(|error| FileError::new("dialog", &error.to_string()))?;
    operate(store.inner().clone(), owner, move |service| {
        let mut paths_buf = Vec::new(); let mut errors = Vec::new();
        for file in paths.unwrap_or_default() {
            match file.into_path() {
                Ok(path) => paths_buf.push(path),
                Err(error) => errors.push(error.to_string()),
            }
        }
        let mut batch = service.open_batch(paths_buf, encoding.as_deref()); batch.errors.extend(errors);
        Ok(batch)
    }).await
}

#[tauri::command]
pub async fn save_dialog(app: AppHandle, window: Window, store: State<'_, FileStore>, source_token: Option<String>, name: String) -> Result<Option<SaveTarget>> {
    let owner=window.label().to_owned();
    let filename = PathBuf::from(name).file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| "Untitled.txt".into());
    let selected = tauri::async_runtime::spawn_blocking(move || app.dialog().file().set_parent(&window).set_file_name(filename).blocking_save_file())
        .await.map_err(|error| FileError::new("dialog", &error.to_string()))?;
    operate(store.inner().clone(), owner, move |service| match selected {
        Some(path) => service.prepare_target(path.into_path().map_err(|error| FileError::new("path", &error.to_string()))?, source_token.as_deref()).map(Some),
        None => Ok(None),
    }).await
}

#[tauri::command]
pub async fn open_recent(window: Window, store: State<'_, FileStore>, path: String, encoding: Option<String>) -> Result<OpenFile> {
    let owner=window.label().to_owned();
    operate(store.inner().clone(), owner, move |service| service.open_recent(&path, encoding.as_deref())).await
}
#[tauri::command]
pub async fn reopen_file(window: Window, store: State<'_, FileStore>, token: String, encoding: String) -> Result<OpenFile> {
    let owner=window.label().to_owned();
    operate(store.inner().clone(), owner, move |service| service.reopen(&token, &encoding)).await
}
#[tauri::command]
pub async fn save_file(window: Window, store: State<'_, FileStore>, token: String, text: String, expected_version: Option<String>, encoding: String, bom: bool) -> Result<FileMetadata> {
    let owner=window.label().to_owned();
    operate(store.inner().clone(), owner, move |service| service.save(&token, &text, expected_version.as_deref(), &encoding, bom)).await
}
#[tauri::command]
pub async fn release_file(window: Window, store: State<'_, FileStore>, token: String) -> Result<()> {
    let owner=window.label().to_owned();
    operate(store.inner().clone(), owner, move |service| { service.release(&token); Ok(()) }).await
}
#[tauri::command]
pub async fn read_class_hex(window: Window, store: State<'_, FileStore>, token: String, expected_version: String, offset: usize) -> Result<crate::files::classfile::HexPage> {
    let owner=window.label().to_owned();
    operate(store.inner().clone(), owner, move |service| service.read_class_hex(&token,&expected_version,offset)).await
}

#[tauri::command]
pub async fn read_markdown_image(window: Window, store: State<'_, FileStore>, workspace: State<'_, crate::commands::workspace::WorkspaceStore>, token: String, relative: String) -> Result<tauri::ipc::Response> {
    let owner=window.label().to_owned();
    let workspace = workspace.for_window(window.label()).map_err(|e|FileError::new("state",&e))?;
    let roots = tauri::async_runtime::spawn_blocking(move || workspace.lock().map(|service| service.roots()).map_err(|_| FileError::new("state", "工作区授权不可用。")))
        .await.map_err(|error| FileError::new("task", &error.to_string()))??;
    operate(store.inner().clone(), owner, move |service| service.markdown_image(&token, &relative, &roots).map(tauri::ipc::Response::new)).await
}
#[tauri::command]
pub async fn drain_pending(window: Window, launches: State<'_, crate::session::LaunchStore>, store: State<'_, FileStore>) -> Result<OpenBatch> {
    let owner=window.label().to_owned();
    let paths={let mut registry=launches.lock().map_err(|_|FileError::new("state","启动状态不可用"))?;let launch=registry.windows.get_mut(&owner).ok_or_else(||FileError::new("state","窗口未注册"))?;std::mem::take(&mut launch.pending)};
    operate(store.inner().clone(), owner, move |service| Ok(service.open_batch(paths,None))).await
}
#[tauri::command]
pub async fn file_preferences(window: Window, store: State<'_, FileStore>) -> Result<Preferences> {
    let owner=window.label().to_owned();
    operate(store.inner().clone(), owner, |service| Ok(service.preferences.clone())).await
}
#[tauri::command]
pub async fn persist_layout(window: Window, launches: State<'_, crate::session::LaunchStore>, store: State<'_, FileStore>, layout: Layout) -> Result<()> {
    let owner=window.label().to_owned();
    if launches.lock().map_err(|_|FileError::new("state","启动状态不可用"))?.owner().as_deref()!=Some(&owner){return Ok(())}
    operate(store.inner().clone(), owner, move |service| service.set_layout(layout)).await
}

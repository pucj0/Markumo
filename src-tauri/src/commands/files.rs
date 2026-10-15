use std::{path::PathBuf, sync::{Arc, Mutex}};
use tauri::{AppHandle, State, Window};
use tauri_plugin_dialog::DialogExt;
use crate::files::{FileError, FileMetadata, FileService, Layout, OpenBatch, OpenFile, Preferences, Result, SaveTarget};

pub type FileStore = Arc<Mutex<FileService>>;

async fn operate<T: Send + 'static>(store: FileStore, action: impl FnOnce(&mut FileService) -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut service = store.lock().map_err(|_| FileError::new("state", "文件服务不可用，编辑内容仍保留。"))?;
        action(&mut service)
    }).await.map_err(|error| FileError::new("task", &error.to_string()))?
}

#[tauri::command]
pub async fn open_dialog(app: AppHandle, window: Window, store: State<'_, FileStore>, encoding: Option<String>) -> Result<OpenBatch> {
    let paths = tauri::async_runtime::spawn_blocking(move || app.dialog().file().set_parent(&window).blocking_pick_files())
        .await.map_err(|error| FileError::new("dialog", &error.to_string()))?;
    operate(store.inner().clone(), move |service| {
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
    let filename = PathBuf::from(name).file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| "Untitled.txt".into());
    let selected = tauri::async_runtime::spawn_blocking(move || app.dialog().file().set_parent(&window).set_file_name(filename).blocking_save_file())
        .await.map_err(|error| FileError::new("dialog", &error.to_string()))?;
    operate(store.inner().clone(), move |service| match selected {
        Some(path) => service.prepare_target(path.into_path().map_err(|error| FileError::new("path", &error.to_string()))?, source_token.as_deref()).map(Some),
        None => Ok(None),
    }).await
}

#[tauri::command]
pub async fn open_recent(store: State<'_, FileStore>, path: String, encoding: Option<String>) -> Result<OpenFile> {
    operate(store.inner().clone(), move |service| service.open_recent(&path, encoding.as_deref())).await
}
#[tauri::command]
pub async fn reopen_file(store: State<'_, FileStore>, token: String, encoding: String) -> Result<OpenFile> {
    operate(store.inner().clone(), move |service| service.reopen(&token, &encoding)).await
}
#[tauri::command]
pub async fn save_file(store: State<'_, FileStore>, token: String, text: String, expected_version: Option<String>, encoding: String, bom: bool) -> Result<FileMetadata> {
    operate(store.inner().clone(), move |service| service.save(&token, &text, expected_version.as_deref(), &encoding, bom)).await
}
#[tauri::command]
pub async fn release_file(store: State<'_, FileStore>, token: String) -> Result<()> {
    operate(store.inner().clone(), move |service| { service.release(&token); Ok(()) }).await
}
#[tauri::command]
pub async fn read_class_hex(store: State<'_, FileStore>, token: String, expected_version: String, offset: usize) -> Result<crate::files::classfile::HexPage> {
    operate(store.inner().clone(), move |service| service.read_class_hex(&token,&expected_version,offset)).await
}
#[tauri::command]
pub async fn drain_pending(store: State<'_, FileStore>) -> Result<OpenBatch> {
    operate(store.inner().clone(), |service| Ok(service.drain())).await
}
#[tauri::command]
pub async fn file_preferences(store: State<'_, FileStore>) -> Result<Preferences> {
    operate(store.inner().clone(), |service| Ok(service.preferences.clone())).await
}
#[tauri::command]
pub async fn persist_layout(store: State<'_, FileStore>, layout: Layout) -> Result<()> {
    operate(store.inner().clone(), move |service| service.set_layout(layout)).await
}

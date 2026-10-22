use crate::history::{HistoryEntry, HistoryRecordResult, HistoryStore, HistoryUsage};
use std::sync::{Arc, Mutex};
use tauri::State;

type HistoryHandle = Arc<Mutex<HistoryStore>>;

fn with_store<T>(
    store: &State<'_, HistoryHandle>,
    action: impl FnOnce(&HistoryStore) -> Result<T, String>,
) -> Result<T, String> {
    let guard = store.lock().map_err(|_| "历史版本存储状态损坏")?;
    action(&guard)
}

/// Records one version for a file. `origin` distinguishes the version that was
/// on disk before a save (`disk`) from the text just written (`saved`) and from
/// an explicit user snapshot (`manual`).
#[tauri::command]
pub async fn history_record(
    store: State<'_, HistoryHandle>,
    path: String,
    text: String,
    origin: String,
    label: Option<String>,
) -> Result<HistoryRecordResult, String> {
    with_store(&store, |history| history.record(&path, &text, &origin, label))
}

/// Metadata only: bodies are fetched on demand by `history_read`.
#[tauri::command]
pub async fn history_list(
    store: State<'_, HistoryHandle>,
    path: String,
) -> Result<Vec<HistoryEntry>, String> {
    with_store(&store, |history| history.list(&path))
}

#[tauri::command]
pub async fn history_read(
    store: State<'_, HistoryHandle>,
    path: String,
    id: String,
) -> Result<String, String> {
    with_store(&store, |history| history.read(&path, &id))
}

#[tauri::command]
pub async fn history_delete(
    store: State<'_, HistoryHandle>,
    path: String,
    id: String,
) -> Result<bool, String> {
    with_store(&store, |history| history.delete(&path, &id))
}

#[tauri::command]
pub async fn history_clear(store: State<'_, HistoryHandle>, path: String) -> Result<(), String> {
    with_store(&store, |history| history.clear(&path))
}

#[tauri::command]
pub async fn history_usage(store: State<'_, HistoryHandle>) -> Result<HistoryUsage, String> {
    with_store(&store, |history| history.usage())
}

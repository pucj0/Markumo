use crate::{
    recovery::{RecoveryInput, RecoveryList, RecoveryRead, RecoverySaveResult, RecoveryStore},
    session::LaunchStore,
};
use tauri::{State, Window};

fn require_owner(window: &Window, launches: &LaunchStore) -> Result<(), String> {
    if launches
        .lock()
        .map_err(|e| e.to_string())?
        .owner()
        .as_deref()
        != Some(window.label())
    {
        return Err("只有主窗口可以访问未保存文档恢复记录".into());
    }
    Ok(())
}

#[tauri::command]
pub fn recovery_list(
    window: Window,
    launches: State<'_, LaunchStore>,
    store: State<'_, RecoveryStore>,
) -> Result<RecoveryList, String> {
    require_owner(&window, &launches)?;
    store.lock().map_err(|e| e.to_string())?.list()
}

#[tauri::command]
pub fn recovery_read(
    window: Window,
    id: String,
    launches: State<'_, LaunchStore>,
    store: State<'_, RecoveryStore>,
) -> Result<RecoveryRead, String> {
    require_owner(&window, &launches)?;
    store.lock().map_err(|e| e.to_string())?.read(&id)
}

#[tauri::command]
pub fn recovery_save(
    window: Window,
    input: RecoveryInput,
    launches: State<'_, LaunchStore>,
    store: State<'_, RecoveryStore>,
) -> Result<RecoverySaveResult, String> {
    require_owner(&window, &launches)?;
    store.lock().map_err(|e| e.to_string())?.save(input)
}

#[tauri::command]
pub fn recovery_delete(
    window: Window,
    id: String,
    launches: State<'_, LaunchStore>,
    store: State<'_, RecoveryStore>,
) -> Result<(), String> {
    require_owner(&window, &launches)?;
    store.lock().map_err(|e| e.to_string())?.delete(&id)
}

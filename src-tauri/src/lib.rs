mod commands;
mod files;
mod workspace;

use std::{path::PathBuf, sync::{Arc, Mutex}};
use tauri::{Emitter, Manager};
use commands::files::FileStore;
use commands::workspace::WorkspaceStore;
use workspace::SearchManager;

fn argument_paths(args: impl IntoIterator<Item = String>, cwd: &std::path::Path) -> Vec<PathBuf> {
    args.into_iter().skip(1).filter(|arg| !arg.starts_with('-')).map(|arg| {
        let path = PathBuf::from(arg); if path.is_absolute() { path } else { cwd.join(path) }
    }).collect()
}

fn queue_external(app: tauri::AppHandle, paths: Vec<PathBuf>) {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<FileStore>();
        if let Ok(mut service) = store.lock() { service.queue(paths); }
        let _ = app.emit("files-pending", ());
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let workspace_store: WorkspaceStore = Arc::new(Mutex::new(workspace::WorkspaceService::default()));
    let search_manager = SearchManager::default();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            queue_external(app.clone(), argument_paths(args, std::path::Path::new(&cwd)));
            if let Some(window) = app.get_webview_window("main") { let _ = window.unminimize(); let _ = window.set_focus(); }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(Mutex::new(files::FileService::default())))
        .manage(workspace_store.clone())
        .manage(search_manager)
        .setup(move |app| {
            let store = app.state::<FileStore>();
            let mut service = store.lock().map_err(|_| std::io::Error::other("文件服务状态损坏"))?;
            let app_data = app.path().app_data_dir()?;
            service.configure(app_data.join("files.json"));
            service.queue(argument_paths(std::env::args(), &std::env::current_dir()?));

            if let Ok(mut ws_service) = workspace_store.lock() {
                ws_service.configure(app_data.join("workspaces.json"));
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Require the registered frontend close handshake. Even startup or
            // failed JS registration must not silently close an unsaved editor.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event { api.prevent_close(); }
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                queue_external(window.app_handle().clone(), paths.clone());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::get_app_version,
            commands::app::open_external_link,
            commands::settings::load_editor_settings, commands::settings::save_editor_settings,
            commands::files::open_dialog, commands::files::save_dialog,
            commands::files::open_recent, commands::files::reopen_file,
            commands::files::save_file, commands::files::release_file,
            commands::files::drain_pending, commands::files::file_preferences, commands::files::persist_layout,
            commands::workspace::open_workspace_dialog,
            commands::workspace::remove_workspace_folder,
            commands::workspace::restore_workspace_folders,
            commands::workspace::open_workspace_path,
            commands::workspace::open_workspace_file,
            commands::workspace::read_directory,
            commands::workspace::create_workspace_file,
            commands::workspace::create_workspace_directory,
            commands::workspace::rename_workspace_node,
            commands::workspace::delete_workspace_node,
            commands::workspace::move_workspace_node,
            commands::workspace::get_recent_workspaces,
            commands::workspace::search_workspace,
            commands::workspace::cancel_workspace_search,
            commands::workspace::find_workspace_files,
            commands::workspace::set_workspace_ignored,
            commands::workspace::reveal_in_explorer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LightEdit");
}

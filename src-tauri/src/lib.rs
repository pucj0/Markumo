mod commands;
mod files;
mod workspace;
mod session;

use std::{path::PathBuf, sync::{Arc, Mutex}};
use tauri::{Emitter, Manager};
use commands::files::FileStore;
use commands::workspace::WorkspaceStore;
use workspace::SearchManager;

/// Registers a window's workspace service and launch record.
fn register_window(app:&tauri::AppHandle,label:&str,paths:Vec<PathBuf>)->Result<(),String>{
    let temporary=!paths.is_empty();
    let mut ws=workspace::WorkspaceService::default();
    ws.configure(app.path().app_data_dir().map_err(|e|e.to_string())?.join("workspaces.json"));
    if temporary{ws.disable_persistence()}
    app.state::<WorkspaceStore>().insert(label,ws)?;
    let state=app.state::<session::LaunchStore>();
    let mut registry=state.lock().map_err(|_|"启动状态不可用".to_string())?;
    if !registry.windows.contains_key(label) { registry.insert(label.into(),paths); }
    Ok(())
}

fn cleanup_window(app:&tauri::AppHandle,label:&str){
    if let Ok(mut registry)=app.state::<session::LaunchStore>().lock(){registry.remove(label);}
    app.state::<WorkspaceStore>().remove(label);
}

/// Brings a window to the front and asks its frontend to open whatever was
/// queued for it. The queued paths stay in the registry until the frontend
/// drains them, so a request that arrives before the page is ready is not lost.
fn deliver(app:&tauri::AppHandle,label:&str){
    let Some(window)=app.get_webview_window(label) else { return };
    let _=window.unminimize();
    let _=window.set_focus();
    let _=window.emit("files-pending",());
}

/// Asks a window to select tabs it already has, without reading the files again
/// or creating duplicate tabs.
fn activate(app:&tauri::AppHandle,label:&str,paths:&[PathBuf]){
    let Some(window)=app.get_webview_window(label) else { return };
    let _=window.unminimize();
    let _=window.set_focus();
    let _=window.emit("external-activate",paths.to_vec());
}

/// External open router. One decision point for every file handed to LightEdit
/// from the shell (double-click, "open with", context menu, second instance).
///
/// Rules:
/// * A file already open in any window activates that window and tab; it is never
///   reloaded over unsaved edits and never duplicated.
/// * A file already queued for a window stays with that window.
/// * Otherwise the most recent single-file window takes the file as a new tab.
/// * With no single-file window, one is created for this batch. A workspace
///   window is never given external files, so its tabs and unsaved work stay put.
fn route_launch(app:tauri::AppHandle,paths:Vec<PathBuf>){
    // WebView2 window creation must run outside a synchronous event handler.
    std::thread::spawn(move||{
        let requested=session::normalize_external_paths(paths);
        if requested.is_empty(){
            // No usable file arguments: surface the primary window instead.
            let label={
                let state=app.state::<session::LaunchStore>();
                let registry=match state.lock(){Ok(registry)=>registry,Err(_)=>return};
                registry.owner().or_else(||registry.latest_window())
            };
            if let Some(label)=label{deliver(&app,&label)}
            return;
        }
        // Ownership snapshot first, then one atomic registry decision. The two
        // locks are never held at the same time, so no ordering deadlock exists.
        let owners:Vec<Option<String>>={
            let store=app.state::<FileStore>();
            let files=match store.lock(){Ok(files)=>files,Err(_)=>return};
            requested.iter().map(|path|files.owner_of_path(path)).collect()
        };
        let plan={
            let state=app.state::<session::LaunchStore>();
            let mut registry=match state.lock(){Ok(registry)=>registry,Err(_)=>return};
            session::plan_external_open(&mut registry,&requested,&owners,&|label|app.get_webview_window(label).is_some())
        };
        for label in &plan.deliveries{deliver(&app,label)}
        for (label,paths) in &plan.activate{activate(&app,label,paths)}
        if let Some((label,initial))=plan.created{
            if let Err(error)=register_window(&app,&label,initial){
                eprintln!("启动窗口失败：{error}");
                cleanup_window(&app,&label);
                return;
            }
            let mut config=app.config().app.windows[0].clone();config.label=label.clone();
            if let Err(error)=tauri::WebviewWindowBuilder::from_config(&app,&config).and_then(|builder|builder.build()){
                eprintln!("创建窗口失败：{error}");
                cleanup_window(&app,&label);
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let workspace_store = WorkspaceStore::default();
    let search_manager = SearchManager::default();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            route_launch(app.clone(), session::argument_paths(args, std::path::Path::new(&cwd)));
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(Arc::new(Mutex::new(files::FileService::default())))
        .manage(workspace_store)
        .manage(session::LaunchStore::default())
        .manage(session::SessionStore::default())
        .manage(search_manager)
        .setup(move |app| {
            let store = app.state::<FileStore>();
            let mut service = store.lock().map_err(|_| std::io::Error::other("文件服务状态损坏"))?;
            let app_data = app.path().app_data_dir()?;
            service.configure(app_data.join("files.json"));
            drop(service);
            app.state::<session::SessionStore>().lock().map_err(|_|std::io::Error::other("会话状态损坏"))?.configure(app_data.join("last-session.json"));
            register_window(app.handle(),"main",session::argument_paths(std::env::args(),&std::env::current_dir()?)).map_err(std::io::Error::other)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Require the registered frontend close handshake. Even startup or
            // failed JS registration must not silently close an unsaved editor.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event { api.prevent_close(); }
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, position }) = event {
                // Frontend hit-tests the editor before deciding import vs open.
                // Send capabilities, never accept arbitrary frontend paths.
                if let Ok(mut files)=window.app_handle().state::<FileStore>().lock(){
                    files.set_owner(window.label());
                    let inputs=files.image_inputs(paths.clone());
                    let scale=window.scale_factor().unwrap_or(1.0);
                    let _=window.emit("native-file-drop",serde_json::json!({"inputs":inputs,"x":position.x as f64/scale,"y":position.y as f64/scale}));
                }
            }
            if let tauri::WindowEvent::Destroyed=event{
                let app=window.app_handle();
                app.state::<WorkspaceStore>().remove(window.label());
                if let Ok(mut registry)=app.state::<session::LaunchStore>().lock(){registry.windows.remove(window.label());}
                if let Ok(mut files)=app.state::<FileStore>().lock(){files.release_owner(window.label());}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::get_app_version,
            commands::session::initialize_launch,commands::session::persist_session,
            commands::app::open_external_link,
            commands::settings::load_editor_settings, commands::settings::save_editor_settings,
            commands::files::open_dialog, commands::files::save_dialog,
            commands::files::open_recent, commands::files::reopen_file,
            commands::files::save_file, commands::files::release_file,
            commands::files::read_class_hex,
            commands::files::read_markdown_image,
            commands::files::choose_markdown_images,commands::files::import_markdown_image,
            commands::files::authorize_markdown_image_directory,commands::files::release_image_inputs,
            commands::files::authorize_markdown_image_read,
            commands::files::open_dropped_files,commands::files::clipboard_image_files,
            commands::workspace::reveal_workspace_node,
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

mod commands;
mod files;
mod workspace;
mod session;

use std::{path::PathBuf, sync::{Arc, Mutex}};
use tauri::{Emitter, Manager};
use commands::files::FileStore;
use commands::workspace::WorkspaceStore;
use workspace::SearchManager;

fn register_window(app:&tauri::AppHandle,label:&str,paths:Vec<PathBuf>)->Result<(),String>{
    let temporary=!paths.is_empty();
    let mut ws=workspace::WorkspaceService::default();
    ws.configure(app.path().app_data_dir().map_err(|e|e.to_string())?.join("workspaces.json"));
    if temporary{ws.disable_persistence()}
    app.state::<WorkspaceStore>().insert(label,ws)?;
    app.state::<session::LaunchStore>().lock().map_err(|e|e.to_string())?.insert(label.into(),paths);
    Ok(())
}

fn route_launch(app:tauri::AppHandle,paths:Vec<PathBuf>){
    // WebView2 window creation must run outside a synchronous event handler.
    std::thread::spawn(move||{
        let label={
            let state=app.state::<session::LaunchStore>();
            let mut registry=match state.lock(){Ok(registry)=>registry,Err(_)=>return};
            if paths.is_empty(){if let Some(label)=registry.owner(){drop(registry);if let Some(window)=app.get_webview_window(&label){let _=window.unminimize();let _=window.set_focus();}return}}
            if registry.windows.len()>=16{eprintln!("打开窗口超过16个，请先关闭部分窗口");return}
            registry.next+=1;
            let label=format!("{}-{}",if paths.is_empty(){"app"}else{"file"},registry.next);
            registry.insert(label.clone(),paths.clone());label
        };
        if let Err(error)=register_window(&app,&label,paths){eprintln!("启动窗口失败：{error}");return}
        let mut config=app.config().app.windows[0].clone();config.label=label.clone();
        let result=tauri::WebviewWindowBuilder::from_config(&app,&config).and_then(|builder|builder.build());
        if let Err(error)=result{
            app.state::<WorkspaceStore>().remove(&label);
            if let Ok(mut registry)=app.state::<session::LaunchStore>().lock(){registry.windows.remove(&label);}
            eprintln!("创建窗口失败：{error}");
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
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                if let Ok(mut registry)=window.app_handle().state::<session::LaunchStore>().lock(){
                    if let Some(launch)=registry.windows.get_mut(window.label()){
                        let capacity=100usize.saturating_sub(launch.pending.len());
                        launch.pending.extend(paths.iter().take(capacity).cloned());
                    }
                }
                let _=window.emit("files-pending",());
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

mod application;
mod commands;
mod domain;
mod infrastructure;

use std::sync::Mutex;

use tauri::Manager;

use application::AppState;
use infrastructure::vault::VaultService;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            app.manage(AppState {
                vault: Mutex::new(VaultService::new(data_dir)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault_status,
            commands::initialize_vault,
            commands::unlock_vault,
            commands::lock_vault,
            commands::touch_activity,
            commands::list_goals,
            commands::set_auto_lock_minutes,
            commands::create_encrypted_backup,
            commands::preview_restore,
            commands::restore_backup,
            commands::create_behavior_event,
            commands::get_behavior_event,
            commands::list_behavior_events,
            commands::update_behavior_event,
            commands::delete_behavior_event,
            commands::today_snapshot,
            commands::list_goal_details,
            commands::save_goal,
            commands::list_plan_actions,
            commands::save_plan_action,
            commands::set_action_completion,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri application could not start");
}

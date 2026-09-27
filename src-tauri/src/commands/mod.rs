use std::path::PathBuf;

use serde::Serialize;
use tauri::State;
use zeroize::Zeroize;

use crate::{
    application::AppState,
    domain::{VaultError, VaultResult},
    infrastructure::vault::{BehaviorEvent, EventInput, Goal, PlanAction, TodaySnapshot, VaultStatus},
};

fn with_vault<T>(
    state: State<'_, AppState>,
    f: impl FnOnce(&mut crate::infrastructure::vault::VaultService) -> VaultResult<T>,
) -> VaultResult<T> {
    let mut vault = state.vault.lock().map_err(|_| VaultError::io())?;
    f(&mut vault)
}

#[tauri::command(async)]
pub fn vault_status(state: State<'_, AppState>) -> VaultResult<VaultStatus> {
    with_vault(state, |vault| vault.status())
}

#[tauri::command(async)]
pub fn initialize_vault(
    state: State<'_, AppState>,
    mut password: String,
    goals: Vec<String>,
) -> VaultResult<VaultStatus> {
    let result = with_vault(state, |vault| vault.initialize(&password, &goals));
    password.zeroize();
    result
}

#[tauri::command(async)]
pub fn unlock_vault(state: State<'_, AppState>, mut password: String) -> VaultResult<VaultStatus> {
    let result = with_vault(state, |vault| vault.unlock(&password));
    password.zeroize();
    result
}

#[tauri::command(async)]
pub fn lock_vault(state: State<'_, AppState>) -> VaultResult<VaultStatus> {
    with_vault(state, |vault| vault.lock())
}

#[tauri::command(async)]
pub fn touch_activity(state: State<'_, AppState>) -> VaultResult<()> {
    with_vault(state, |vault| vault.touch())
}

#[tauri::command(async)]
pub fn list_goals(state: State<'_, AppState>) -> VaultResult<Vec<String>> {
    with_vault(state, |vault| vault.list_goals())
}

#[tauri::command(async)]
pub fn set_auto_lock_minutes(state: State<'_, AppState>, minutes: u32) -> VaultResult<VaultStatus> {
    with_vault(state, |vault| vault.set_auto_lock_minutes(minutes))
}

#[tauri::command(async)]
pub fn create_encrypted_backup(
    state: State<'_, AppState>,
    mut password: String,
) -> VaultResult<String> {
    let result = with_vault(state, |vault| {
        vault
            .create_backup(&password)
            .map(|p| p.to_string_lossy().into_owned())
    });
    password.zeroize();
    result
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePreview {
    pub goal_count: u64,
    pub created_at: u64,
}

#[tauri::command(async)]
pub fn preview_restore(
    state: State<'_, AppState>,
    path: String,
    mut password: String,
) -> VaultResult<RestorePreview> {
    let result = with_vault(state, |vault| {
        vault.preview_restore(&PathBuf::from(path), &password)
    });
    password.zeroize();
    result
}

#[tauri::command(async)]
pub fn restore_backup(
    state: State<'_, AppState>,
    path: String,
    mut password: String,
) -> VaultResult<VaultStatus> {
    let result = with_vault(state, |vault| {
        vault.restore_backup(&PathBuf::from(path), &password)
    });
    password.zeroize();
    result
}

#[tauri::command(async)]
pub fn create_behavior_event(state: State<'_, AppState>, input: EventInput) -> VaultResult<BehaviorEvent> {
    with_vault(state, |v| v.create_event(input))
}

#[tauri::command(async)]
pub fn get_behavior_event(state: State<'_, AppState>, id: String) -> VaultResult<BehaviorEvent> {
    with_vault(state, |v| v.event(&id))
}

#[tauri::command(async)]
pub fn list_behavior_events(state: State<'_, AppState>, from: Option<String>, to: Option<String>, event_type: Option<String>, limit: u32, offset: u32) -> VaultResult<Vec<BehaviorEvent>> {
    with_vault(state, |v| v.list_events(from, to, event_type, limit, offset))
}

#[tauri::command(async)]
pub fn update_behavior_event(state: State<'_, AppState>, id: String, input: EventInput) -> VaultResult<BehaviorEvent> {
    with_vault(state, |v| v.update_event(&id, input))
}

#[tauri::command(async)]
pub fn delete_behavior_event(state: State<'_, AppState>, id: String) -> VaultResult<()> {
    with_vault(state, |v| v.delete_event(&id))
}

#[tauri::command(async)]
pub fn today_snapshot(state: State<'_, AppState>, today: String, from: String) -> VaultResult<TodaySnapshot> {
    with_vault(state, |v| v.today_snapshot(&today, &from))
}

#[tauri::command(async)]
pub fn list_goal_details(state: State<'_, AppState>) -> VaultResult<Vec<Goal>> { with_vault(state, |v| v.goal_details()) }

#[tauri::command(async)]
pub fn save_goal(state: State<'_, AppState>, id: Option<String>, title: String, status: String) -> VaultResult<Goal> { with_vault(state, |v| v.save_goal(id, title, status)) }

#[tauri::command(async)]
pub fn list_plan_actions(state: State<'_, AppState>, date: String) -> VaultResult<Vec<PlanAction>> { with_vault(state, |v| v.list_actions(&date)) }

#[tauri::command(async)]
pub fn save_plan_action(state: State<'_, AppState>, id: Option<String>, goal_id: String, title: String, enabled: bool) -> VaultResult<()> { with_vault(state, |v| v.save_action(id, goal_id, title, enabled)) }

#[tauri::command(async)]
pub fn set_action_completion(state: State<'_, AppState>, action_id: String, date: String, done: bool) -> VaultResult<()> { with_vault(state, |v| v.set_action_completion(&action_id, &date, done)) }

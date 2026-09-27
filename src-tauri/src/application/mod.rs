use std::sync::Mutex;

use crate::infrastructure::vault::VaultService;

pub struct AppState {
    pub vault: Mutex<VaultService>,
}

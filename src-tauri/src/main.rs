// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod libsql;
mod state;

use anyhow::Result;
use mozilla_assist_lib::{
    imap_client::{fetch_inbox as imap_fetch_inbox, messages_to_json_values},
    settings::get_settings,
};
use serde_json;
use std::env;
use tauri::{command, ActivationPolicy, Manager};
use tokio::sync::Mutex;

use crate::state::AppState;

#[command]
async fn toggle_dock_icon(app_handle: tauri::AppHandle, show: bool) -> Result<(), String> {
    if cfg!(target_os = "macos") {
        let policy = if show {
            ActivationPolicy::Regular
        } else {
            ActivationPolicy::Accessory
        };

        let _ = app_handle.set_activation_policy(policy);
    }

    Ok(())
}

#[command]
async fn list_mailboxes(app_handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let state = app_handle.state::<Mutex<AppState>>();
    let settings = {
        let mut state = state.lock().await;
        let conn = state
            .libsql
            .as_mut()
            .ok_or_else(|| "Database not initialized".to_string())?;

        get_settings(conn)
            .await
            .map_err(|e| format!("Failed to get settings: {}", e))?
    };

    // Call the list_mailboxes function from imap_client
    let mailboxes = mozilla_assist_lib::imap_client::list_mailboxes(&settings)
        .map_err(|e| format!("Failed to list mailboxes: {}", e))?;

    // Convert the HashMap to a JSON value
    serde_json::to_value(&mailboxes).map_err(|e| format!("Failed to serialize mailboxes: {}", e))
}

#[command]
async fn fetch_inbox(
    app_handle: tauri::AppHandle,
    count: Option<usize>,
) -> Result<serde_json::Value, String> {
    let state = app_handle.state::<Mutex<AppState>>();
    let settings = {
        let mut state = state.lock().await;
        let conn = state
            .libsql
            .as_mut()
            .ok_or_else(|| "Database not initialized".to_string())?;

        get_settings(conn)
            .await
            .map_err(|e| format!("Failed to get settings: {}", e))?
    };

    // Fetch the raw messages
    let messages = imap_fetch_inbox(&settings, count)
        .map_err(|e| format!("Failed to fetch inbox top: {}", e))?;

    // Process all messages using the utility function
    let processed_messages = messages_to_json_values(&messages)
        .map_err(|e| format!("Failed to convert messages to JSON: {}", e))?;

    // Convert the processed messages to a single JSON value
    serde_json::to_value(&processed_messages)
        .map_err(|e| format!("Failed to serialize messages: {}", e))
}

#[tokio::main]
async fn main() -> Result<()> {
    // This should be called as early in the execution of the app as possible
    #[cfg(debug_assertions)] // only enable instrumentation in development builds
    let devtools = tauri_plugin_devtools::init();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            app.manage(Mutex::new(AppState::default()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            toggle_dock_icon,
            libsql::init_libsql,
            libsql::execute,
            libsql::select,
            fetch_inbox,
            list_mailboxes
        ]);

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(devtools);
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    Ok(())
}

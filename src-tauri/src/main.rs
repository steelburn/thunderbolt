// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod embedding;
mod imap_client;

use anyhow::Result;
use sea_orm::ActiveModelTrait;
use std::env;
use tauri::command;

use entity::*;

#[command]
fn get_openai_api_key() -> String {
    println!(
        "get_openai_api_key {}",
        env::var("OPENAI_API_KEY").unwrap_or_default()
    );

    if let Ok(path) = env::var("CARGO_MANIFEST_DIR") {
        let env_path = std::path::Path::new(&path).join(".env");
        if env_path.exists() {
            dotenv::from_path(env_path).ok();
        }
    }

    let open_ai_api_key =
        env::var("OPENAI_API_KEY").expect("OPENAI_API_KEY environment variable must be set");

    open_ai_api_key
}

#[tokio::main]
async fn main() -> Result<()> {
    // This should be called as early in the execution of the app as possible
    #[cfg(debug_assertions)] // only enable instrumentation in development builds
    let devtools = tauri_plugin_devtools::init();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![get_openai_api_key,]);

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(devtools);
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    // Handle the Result and Option types
    let body = imap_client::fetch_inbox_top().unwrap().unwrap();

    let message = imap_client::parse_email_to_message(&body, None)?;

    let db = db::init_db().await?;

    // let message = message::ActiveModel {
    //     id: Set(1),
    //     date: Set(chrono::Utc::now()),
    //     subject: Set("Test Subject".to_owned()),
    //     body: Set("This is the message body".to_owned()),
    //     snippet: Set("This is the snippet".to_owned()),
    //     clean_text: Set("This is the clean text".to_owned()),
    //     clean_text_tokens_in: Set(0),
    //     clean_text_tokens_out: Set(0),
    // };

    let inserted_message: message::Model = message.insert(&db).await?;

    let embedding = embedding::get_embedding("Hello, world!")?;
    println!("{:?}", embedding);

    mozilla_assist_lib::run();

    Ok(())
}

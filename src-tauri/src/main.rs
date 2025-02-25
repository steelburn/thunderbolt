// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod embedding;
mod imap_client;

#[tokio::main]
async fn main() -> Result<()> {
    // Handle the Result and Option types
    match imap_client::fetch_inbox_top() {
        Ok(Some(body)) => println!("{}", body),
        Ok(None) => println!("No message found"),
        Err(e) => eprintln!("Error: {}", e),
    }

    match db::init_db().await {
        Ok(_db) => println!("Database initialized"),
        Err(e) => eprintln!("Error: {}", e),
    }

    mozilla_assist_lib::run();

    Ok(())
}

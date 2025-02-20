use mozilla_assist_lib::embedding::get_embedding;
use serde::Deserialize;
use std::time::{Duration, Instant};

#[derive(Deserialize)]
struct Message {
    clean_text: String,
}

// Note: this must be built with "--release" in order to work. If you run it without building for release, it will just hang.
fn main() -> Result<(), anyhow::Error> {
    // Get input file path from env var or use default
    let input_file =
        std::env::var("INPUT_FILE").unwrap_or_else(|_| "data/sample-messages.json".to_string());

    // Read and parse the JSON file
    let json_str = std::fs::read_to_string(input_file)?;
    let messages: Vec<Message> = serde_json::from_str(&json_str)?;

    let start_time = Instant::now();
    let mut total_duration = Duration::from_secs(0);

    for (i, message) in messages.iter().enumerate() {
        if message.clean_text.is_empty() {
            println!("Skipping message {i} - empty text");
            continue;
        }

        let msg_start = Instant::now();
        let _embedding = get_embedding(&message.clean_text)?;
        let duration = msg_start.elapsed();
        total_duration += duration;

        println!(
            "Message {i} ({} chars) took {:.2?}",
            message.clean_text.len(),
            duration
        );
    }

    println!("\nTotal time: {:.2?}", start_time.elapsed());
    println!(
        "Average time: {:.2?}",
        total_duration / messages.len() as u32
    );

    Ok(())
}

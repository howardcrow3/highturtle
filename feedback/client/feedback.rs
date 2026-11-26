// Feedback client for the Tauri apps (Rust side), so the signing key stays out of the web bundle.
// Cargo: reqwest = { version = "0.12", features = ["json", "rustls-tls"] }, hmac = "0.12", sha2 = "0.10",
//        hex = "0.4", serde = { version = "1", features = ["derive"] }, serde_json = "1"
//
// The key is baked in at compile time from the CI secret FEEDBACK_KEY (never committed):
//   FEEDBACK_KEY=${{ secrets.FEEDBACK_KEY }} cargo tauri build
// A dev build without the variable gets None and the UI should hide or disable the feedback form.
//
// Expose it as a Tauri command:
//   #[tauri::command] async fn send_feedback(fb: Feedback) -> Result<Receipt, String> { feedback::send(fb).await }
// and from the UI: await invoke('send_feedback', { fb: { app: 'backer', rating: 5, message: '...' } })

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

pub const FEEDBACK_URL: &str = "https://feedback.turtlebox.studio/v1/feedback";
const APP: &str = "backer"; // "backer" | "ceevee" | "golden"
const KEY: Option<&str> = option_env!("FEEDBACK_KEY");

#[derive(Serialize, Deserialize)]
pub struct Feedback {
    pub app: String,
    #[serde(skip_serializing_if = "Option::is_none")] pub rating: Option<u8>,      // 1..=5
    #[serde(skip_serializing_if = "Option::is_none")] pub message: Option<String>, // up to 5000 chars
    #[serde(skip_serializing_if = "Option::is_none")] pub category: Option<String>, // feature | issue | praise | other
    #[serde(skip_serializing_if = "Option::is_none")] pub email: Option<String>,    // only if the user offers it
    #[serde(rename = "appVersion", skip_serializing_if = "Option::is_none")] pub app_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub platform: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct Receipt {
    pub id: String,
    #[serde(rename = "createdAt")] pub created_at: String,
}

pub async fn send(mut fb: Feedback) -> Result<Receipt, String> {
    let key = KEY.ok_or("feedback is not configured in this build")?;
    fb.app = APP.to_string();
    if fb.app_version.is_none() { fb.app_version = Some(env!("CARGO_PKG_VERSION").to_string()); }
    if fb.platform.is_none() { fb.platform = Some(std::env::consts::OS.to_string()); }

    let body = serde_json::to_string(&fb).map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs().to_string();
    let key_bytes = hex::decode(key).map_err(|_| "bad feedback key")?;
    let mut mac = Hmac::<Sha256>::new_from_slice(&key_bytes).map_err(|e| e.to_string())?;
    mac.update(format!("{ts}.{body}").as_bytes());
    let sig = hex::encode(mac.finalize().into_bytes());

    let res = reqwest::Client::new()
        .post(FEEDBACK_URL)
        .header("content-type", "application/json")
        .header("x-ht-app", APP)
        .header("x-ht-timestamp", &ts)
        .header("x-ht-signature", sig)
        .body(body)
        .send().await.map_err(|e| format!("could not reach the feedback service: {e}"))?;
    let status = res.status();
    if status.is_success() {
        res.json::<Receipt>().await.map_err(|e| e.to_string())
    } else {
        let msg = res.json::<serde_json::Value>().await.ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from))
            .unwrap_or_else(|| format!("feedback failed ({status})"));
        Err(msg)
    }
}

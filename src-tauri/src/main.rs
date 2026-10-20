#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, io::Write, path::PathBuf, sync::Mutex};
use tauri::Manager;
use serde_json::{json, Value};

struct StoreLock(Mutex<()>);
mod speech;

#[tauri::command]
async fn speech_voices() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(speech::voices).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn synthesize_speech(text: String, voice_id: String, lang: String, rate: f64) -> Result<tauri::ipc::Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || speech::synthesize(&text, &voice_id, &lang, rate)).await.map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(windows)]
fn seal(bytes: &[u8], decrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{Foundation::LocalFree, Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN}};
    let input = CRYPT_INTEGER_BLOB { cbData: bytes.len() as u32, pbData: bytes.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    let ok = unsafe {
        if decrypt {
            CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut output)
        } else {
            CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut output)
        }
    };
    if ok == 0 { return Err("无法读取或加密本机存档，请使用原 Windows 用户重试。".into()); }
    let result = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe { LocalFree(output.pbData as *mut _); }
    Ok(result)
}

#[cfg(not(windows))]
fn seal(_: &[u8], _: bool) -> Result<Vec<u8>, String> { Err("当前构建仅支持 Windows。".into()) }

fn store_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn revision(text: &str) -> Result<u64, String> {
    if text.len() > 64 * 1024 * 1024 { return Err("存档超过 64 MB。".into()); }
    let data: Value = serde_json::from_str(text).map_err(|_| "存档格式无效。")?;
    let rev = data["revision"].as_u64().ok_or("存档版本无效。")?;
    if rev > 9_007_199_254_740_991 || data["version"] != 1 { return Err("存档版本无效。".into()); }
    let entries = data["data"].as_object().ok_or("存档记录无效。")?;
    if entries.iter().any(|(k,v)| !(k.starts_with("dreamwhale:") || k.starts_with("word-blade:")) || !v.is_string()) { return Err("存档记录无效。".into()); }
    Ok(rev)
}

fn read_slots(dir: &std::path::Path) -> Result<(Option<(u64, String, usize)>, bool), String> {
    let mut best: Option<(u64, String, usize)> = None;
    let mut damaged = false;
    for slot in 0..2 {
        let path = dir.join(format!("store.{slot}.bin"));
        if !path.exists() { continue; }
        let candidate = (|| -> Result<(u64, String, usize), String> {
            if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 65 * 1024 * 1024 { return Err("存档过大。".into()); }
            let bytes = fs::read(path).map_err(|e| e.to_string())?;
            let text = String::from_utf8(seal(&bytes, true)?).map_err(|_| "存档编码无效。")?;
            Ok((revision(&text)?, text, slot))
        })();
        match candidate {
            Ok(value) if best.as_ref().map_or(true, |old| value.0 > old.0) => best = Some(value),
            Ok(_) => {}, Err(_) => damaged = true,
        }
    }
    if best.is_none() && damaged { return Err("本机存档无法读取，已保留原文件。请勿卸载应用或清除数据。".into()); }
    Ok((best, damaged))
}

#[tauri::command]
fn load_store(app: tauri::AppHandle, guard: tauri::State<StoreLock>) -> Result<Value, String> {
    let _lock = guard.0.lock().map_err(|e| e.to_string())?;
    let (best, recovered) = read_slots(&store_dir(&app)?)?;
    Ok(json!({"text": best.map(|v| v.1), "recovered": recovered}))
}

#[tauri::command]
fn save_store(app: tauri::AppHandle, guard: tauri::State<StoreLock>, text: String) -> Result<(), String> {
    let _lock = guard.0.lock().map_err(|e| e.to_string())?;
    let next = revision(&text)?;
    let dir = store_dir(&app)?;
    let (old, _) = read_slots(&dir)?;
    let target_slot = old.as_ref().map_or(0, |v| 1 - v.2);
    if let Some((rev, prior, _)) = old {
        if rev > next || (rev == next && prior != text) { return Err("存档已被另一进程更新，请重新打开应用。".into()); }
        if prior == text { return Ok(()); }
    }
    let bytes = seal(text.as_bytes(), false)?;
    let temp = dir.join("store.tmp");
    let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
    file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(temp, dir.join(format!("store.{target_slot}.bin"))).map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| { if let Some(window) = app.get_webview_window("main") { let _ = window.unminimize(); let _ = window.set_focus(); } }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(StoreLock(Mutex::new(())))
        .invoke_handler(tauri::generate_handler![load_store, save_store, speech_voices, synthesize_speech])
        .run(tauri::generate_context!())
        .expect("无法启动梦鲸词汇");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypted_store_recovers_last_complete_slot_and_rejects_corruption() {
        let dir = std::env::temp_dir().join(format!("dreamwhale-store-test-{}", std::process::id()));
        fs::create_dir(&dir).unwrap();
        let older = r#"{"version":1,"revision":1,"data":{"dreamwhale:test":"private"}}"#;
        let newer = r#"{"version":1,"revision":8,"data":{"dreamwhale:test":"latest"}}"#;
        let encrypted = seal(older.as_bytes(), false).unwrap();
        assert!(!encrypted.windows(7).any(|bytes| bytes == b"private"));
        fs::write(dir.join("store.0.bin"), encrypted).unwrap();
        fs::write(dir.join("store.1.bin"), seal(newer.as_bytes(), false).unwrap()).unwrap();
        let (best, damaged) = read_slots(&dir).unwrap();
        assert_eq!(best.unwrap().1, newer); assert!(!damaged);
        fs::write(dir.join("store.1.bin"), b"broken").unwrap();
        let (best, damaged) = read_slots(&dir).unwrap();
        assert_eq!(best.unwrap().1, older); assert!(damaged);
        fs::write(dir.join("store.0.bin"), b"broken").unwrap();
        assert!(read_slots(&dir).is_err());
        for slot in 0..2 { fs::remove_file(dir.join(format!("store.{slot}.bin"))).unwrap(); }
        fs::remove_dir(dir).unwrap();
    }
}

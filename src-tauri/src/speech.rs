use serde_json::{json, Value};
use windows::{core::HSTRING, Media::SpeechSynthesis::SpeechSynthesizer, Storage::Streams::DataReader,
    Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED}};

struct Apartment;
impl Apartment {
    fn new() -> Result<Self, String> {
        unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.map_err(|e| e.to_string())?;
        Ok(Self)
    }
}
impl Drop for Apartment { fn drop(&mut self) { unsafe { RoUninitialize(); } } }

pub fn voices() -> Result<Value, String> {
    let _apartment = Apartment::new()?;
    let voices = SpeechSynthesizer::AllVoices().map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for voice in voices {
        result.push(json!({"id": voice.Id().map_err(|e| e.to_string())?.to_string(),
            "name": voice.DisplayName().map_err(|e| e.to_string())?.to_string(),
            "lang": voice.Language().map_err(|e| e.to_string())?.to_string(), "local": true}));
    }
    Ok(json!(result))
}

pub fn synthesize(text: &str, voice_id: &str, lang: &str, rate: f64) -> Result<Vec<u8>, String> {
    if text.is_empty() || text.chars().count() > 2000 || !["en-US", "en-GB"].contains(&lang)
        || !rate.is_finite() || !(0.5..=1.5).contains(&rate) { return Err("朗读参数无效。".into()); }
    let _apartment = Apartment::new()?;
    let work = || -> windows::core::Result<Vec<u8>> {
        let synth = SpeechSynthesizer::new()?;
        let mut found = false;
        for voice in SpeechSynthesizer::AllVoices()? {
            if voice.Id()?.to_string() == voice_id && voice.Language()?.to_string().eq_ignore_ascii_case(lang) {
                synth.SetVoice(&voice)?; found = true; break;
            }
        }
        if !found { return Err(windows::core::Error::new(windows::core::HRESULT(0x80070002u32 as i32), "所选口音的离线声音已不可用，请安装英语语音包并刷新声音。")); }
        synth.Options()?.SetSpeakingRate(rate)?;
        let stream = synth.SynthesizeTextToStreamAsync(&HSTRING::from(text))?.join()?;
        let size = stream.Size()?;
        if size > 16 * 1024 * 1024 { return Err(windows::core::Error::new(windows::core::HRESULT(0x8007000Eu32 as i32), "语音片段过长。")); }
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
        reader.LoadAsync(size as u32)?.join()?;
        let mut bytes = vec![0; size as usize]; reader.ReadBytes(&mut bytes)?;
        reader.Close()?; stream.Close()?; synth.Close()?;
        Ok(bytes)
    };
    work().map_err(|e| format!("离线朗读失败：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installed_english_voices_generate_wave_at_selected_rate() {
        let list = voices().unwrap();
        eprintln!("Installed voices: {list}");
        let mut checked = 0;
        for lang in ["en-US", "en-GB"] {
            if let Some(voice) = list.as_array().unwrap().iter().find(|v| v["lang"] == lang) {
                let id = voice["id"].as_str().unwrap();
                let slow = synthesize("The library is open every day.", id, lang, 0.65).unwrap();
                let fast = synthesize("The library is open every day.", id, lang, 1.3).unwrap();
                assert_eq!(&slow[..4], b"RIFF"); assert_eq!(&slow[8..12], b"WAVE");
                assert!(slow.len() > fast.len());
                eprintln!("{lang}: slow={} fast={} bytes", slow.len(), fast.len());
                checked += 1;
            } else { eprintln!("{lang}: voice pack not installed"); }
        }
        assert!(checked > 0, "No installed English voice to verify");
        assert!(synthesize("Hello", "missing", "en-GB", 1.0).is_err());
        assert!(synthesize("Hello", "missing", "en-US", 9.0).is_err());
    }
}

package com.dreamwhale.vocab;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.AtomicFile;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "Dreamwhale")
public class DreamwhalePlugin extends Plugin {
    private static final int MAX_STORE = 64 * 1024 * 1024;
    private final Object storeLock = new Object();
    private final ExecutorService network = Executors.newFixedThreadPool(4);
    private final ConcurrentHashMap<String, Request> requests = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, PluginCall> speeches = new ConcurrentHashMap<>();
    private TextToSpeech speech;
    private volatile boolean speechReady;
    private volatile boolean speechInitFailed;
    private volatile boolean destroyed;
    private volatile boolean pickingFile;

    @Override public void load() {
        getActivity().runOnUiThread(() -> {
            speech = new TextToSpeech(getContext(), status -> { speechReady = status == TextToSpeech.SUCCESS; speechInitFailed = !speechReady; });
            speech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) {}
                @Override public void onDone(String id) { finishSpeech(id, null); }
                @Override public void onError(String id) { finishSpeech(id, "朗读失败，请检查英语语音包。"); }
                @Override public void onStop(String id, boolean interrupted) { finishSpeech(id, null); }
            });
        });
    }

    private void finishSpeech(String id, String error) {
        PluginCall call = speeches.remove(id);
        if (call != null) { if (error == null) call.resolve(); else call.reject(error); }
    }

    private SecretKey key() throws Exception {
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore"); keys.load(null);
        String alias = "dreamwhale-store-v1";
        if (!keys.containsAlias(alias)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) keys.getKey(alias, null);
    }

    private byte[] seal(byte[] bytes, boolean decrypt) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        if (decrypt) {
            if (bytes.length < 28) throw new IOException("存档不完整。");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Arrays.copyOf(bytes, 12)));
            return cipher.doFinal(bytes, 12, bytes.length - 12);
        }
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(bytes), iv = cipher.getIV();
        ByteArrayOutputStream result = new ByteArrayOutputStream(); result.write(iv); result.write(encrypted); return result.toByteArray();
    }

    private long revision(String text) throws Exception {
        if (text.getBytes(StandardCharsets.UTF_8).length > MAX_STORE) throw new IOException("存档超过 64 MB。");
        JSONObject value = new JSONObject(text);
        long revision = value.getLong("revision");
        if (value.getInt("version") != 1 || revision < 0 || revision > 9007199254740991L) throw new IOException("存档版本无效。");
        JSONObject data = value.getJSONObject("data");
        Iterator<String> keys = data.keys();
        while (keys.hasNext()) {
            String name = keys.next();
            if (!(name.startsWith("dreamwhale:") || name.startsWith("word-blade:")) || !(data.get(name) instanceof String)) throw new IOException("存档记录无效。");
        }
        return revision;
    }

    private byte[] readLimited(InputStream stream, int limit) throws IOException {
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int length, total = 0;
            while ((length = input.read(buffer)) != -1) {
                total += length; if (total > limit) throw new IOException("文件超过允许大小。"); output.write(buffer, 0, length);
            }
            return output.toByteArray();
        }
    }

    private JSObject readStore() throws Exception {
        String best = null; long latest = -1; int bestSlot = -1; boolean damaged = false;
        for (int slot = 0; slot < 2; slot++) {
            File path = new File(getContext().getFilesDir(), "store." + slot + ".bin");
            if (!path.exists() && !new File(path + ".bak").exists()) continue;
            try {
                byte[] bytes = readLimited(new AtomicFile(path).openRead(), MAX_STORE + 1024);
                String text = new String(seal(bytes, true), StandardCharsets.UTF_8);
                long rev = revision(text); if (rev > latest) { latest = rev; best = text; bestSlot = slot; }
            } catch (Exception error) { damaged = true; }
        }
        if (best == null && damaged) throw new IOException("本机存档无法读取，原文件已保留。请勿卸载应用或清除数据。");
        JSObject result = new JSObject(); result.put("text", best == null ? JSONObject.NULL : best); result.put("recovered", damaged); result.put("slot", bestSlot); return result;
    }

    @PluginMethod public void loadStore(PluginCall call) {
        synchronized (storeLock) { try { call.resolve(readStore()); } catch (Exception e) { call.reject(e.getMessage()); } }
    }

    @PluginMethod public void saveStore(PluginCall call) {
        synchronized (storeLock) {
            try {
                String text = call.getString("text"); if (text == null) throw new IOException("缺少存档。");
                long next = revision(text); JSObject stored = readStore(); String prior = stored.getString("text", null);
                if (prior != null) {
                    long old = revision(prior);
                    if (old > next || (old == next && !prior.equals(text))) throw new IOException("存档已更新，请重新打开应用。");
                    if (prior.equals(text)) { call.resolve(); return; }
                }
                byte[] bytes = seal(text.getBytes(StandardCharsets.UTF_8), false);
                int targetSlot = stored.getInt("slot") == 0 ? 1 : 0;
                AtomicFile file = new AtomicFile(new File(getContext().getFilesDir(), "store." + targetSlot + ".bin"));
                FileOutputStream output = null;
                try { output = file.startWrite(); output.write(bytes); file.finishWrite(output); }
                catch (Exception error) { if (output != null) file.failWrite(output); throw error; }
                call.resolve();
            } catch (Exception e) { call.reject(e.getMessage()); }
        }
    }

    @PluginMethod public void copyText(PluginCall call) {
        ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(ClipData.newPlainText("梦鲸词汇", call.getString("text", ""))); call.resolve();
    }

    private boolean installedVoice(Voice voice) {
        return voice.getFeatures() == null || !voice.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED);
    }

    private SpeechResolver.Choice voiceChoice(Voice voice) {
        return new SpeechResolver.Choice(voice.getName(), voice.getName(), voice.getLocale(), !voice.isNetworkConnectionRequired(), installedVoice(voice));
    }

    private SpeechResolver.Choice resolveSpeech(String accent, boolean offline) {
        return SpeechResolver.resolve(new SpeechResolver.Engine() {
            final Map<String, Voice> byId = new HashMap<>();
            public List<SpeechResolver.Choice> voices() {
                List<SpeechResolver.Choice> result = new ArrayList<>();
                Set<Voice> available = speech.getVoices();
                if (available != null) for (Voice voice : available) { byId.put(voice.getName(), voice); result.add(voiceChoice(voice)); }
                return result;
            }
            public boolean setVoice(String id) { return byId.containsKey(id) && speech.setVoice(byId.get(id)) == TextToSpeech.SUCCESS; }
            public SpeechResolver.Choice setLanguage(Locale locale) {
                if (speech.setLanguage(locale) < TextToSpeech.LANG_AVAILABLE) return null;
                Voice voice = null;
                try { voice = speech.getVoice(); } catch (RuntimeException ignored) {}
                return voice != null ? voiceChoice(voice) : new SpeechResolver.Choice("", "系统默认英语", Locale.ENGLISH, null, true);
            }
        }, accent, offline);
    }

    private void whenSpeechReady(PluginCall call, Runnable action, long deadline) {
        if (destroyed || speechInitFailed) { call.reject("系统文字转语音服务无法启动，请检查手机的语音引擎。"); return; }
        if (speechReady && speech != null) { try { action.run(); } catch (Exception error) { call.reject(error.getMessage()); } return; }
        if (android.os.SystemClock.uptimeMillis() >= deadline) { call.reject("系统语音服务启动较慢，请稍后重试。"); return; }
        getActivity().getWindow().getDecorView().postDelayed(() -> whenSpeechReady(call, action, deadline), 100);
    }

    @PluginMethod public void prepareSpeech(PluginCall call) {
        getActivity().runOnUiThread(() -> whenSpeechReady(call, () -> {
            SpeechResolver.Choice voice = resolveSpeech(call.getString("speechAccent", "en-US"), call.getBoolean("speechOffline", false));
            call.resolve(new JSObject().put("id", voice.id()).put("name", voice.name()).put("lang", voice.locale().toLanguageTag())
                .put("local", voice.local() == null ? JSONObject.NULL : voice.local()));
        }, android.os.SystemClock.uptimeMillis() + 3000));
    }

    @PluginMethod public void speechVoices(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!speechReady || speech == null) { call.reject("语音服务尚未就绪，请检查系统文字转语音引擎并点击刷新声音。"); return; }
            JSArray voices = new JSArray();
            Set<Voice> available = speech.getVoices();
            if (available != null) for (Voice voice : available) {
                if (!installedVoice(voice)) continue;
                voices.put(new JSObject().put("id", voice.getName()).put("name", voice.getName()).put("lang", voice.getLocale().toLanguageTag()).put("local", !voice.isNetworkConnectionRequired()));
            }
            call.resolve(new JSObject().put("voices", voices));
        });
    }

    private void stopAllSpeech() {
        if (speech != null) speech.stop();
        for (String id : speeches.keySet()) finishSpeech(id, null);
    }

    @PluginMethod public void stopSpeech(PluginCall call) {
        getActivity().runOnUiThread(() -> { stopAllSpeech(); call.resolve(); });
    }

    @PluginMethod public void speak(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!speechReady || speech == null) { call.reject("朗读尚未就绪，请检查设备的文字转语音引擎和英语语音包后重试。"); return; }
            String text = call.getString("text", "");
            if (text.length() > 2000) { call.reject("请分段朗读较长的文字。"); return; }
            String accent = call.getString("speechAccent", "en-US");
              boolean offline = call.getBoolean("speechOffline", false);
              try { resolveSpeech(accent, offline); } catch (Exception error) { call.reject(error.getMessage()); return; }
            double rate = call.getDouble("speechRate", 0.85);
            if (!Double.isFinite(rate) || rate < 0.5 || rate > 1.5) rate = 0.85;
            stopAllSpeech();
            String id = UUID.randomUUID().toString(); speeches.put(id, call); speech.setSpeechRate((float)rate);
            if (speech.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) == TextToSpeech.ERROR) finishSpeech(id, "朗读失败，请重试。");
            getActivity().getWindow().getDecorView().postDelayed(() -> {
                if (speeches.containsKey(id)) { finishSpeech(id, "朗读超时，请检查系统语音服务后重试。"); speech.stop(); }
            }, 90000);
        });
    }

    @PluginMethod public synchronized void saveFile(PluginCall call) {
        if (pickingFile) { call.reject("请先完成当前文件选择。"); return; } pickingFile = true;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType(call.getString("type", "application/json").split(";")[0]).putExtra(Intent.EXTRA_TITLE, call.getString("name", "梦鲸备份.json"));
        try { startActivityForResult(call, intent, "savedFile"); } catch (Exception e) { pickingFile = false; call.reject(e.getMessage()); }
    }

    @ActivityCallback private void savedFile(PluginCall call, ActivityResult result) {
        pickingFile = false; if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.resolve(new JSObject().put("saved", false)); return; }
        try (OutputStream output = getContext().getContentResolver().openOutputStream(result.getData().getData(), "wt")) {
            if (output == null) throw new IOException("无法写入所选文件。");
            output.write(call.getString("content", "").getBytes(StandardCharsets.UTF_8)); output.flush();
            call.resolve(new JSObject().put("saved", true));
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod public synchronized void pickFile(PluginCall call) {
        if (pickingFile) { call.reject("请先完成当前文件选择。"); return; } pickingFile = true;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
            .putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
        try { startActivityForResult(call, intent, "pickedFile"); } catch (Exception e) { pickingFile = false; call.reject(e.getMessage()); }
    }

    @ActivityCallback private void pickedFile(PluginCall call, ActivityResult result) {
        pickingFile = false; if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.resolve(new JSObject().put("text", JSONObject.NULL)); return; }
        try {
            InputStream input = getContext().getContentResolver().openInputStream(result.getData().getData());
            if (input == null) throw new IOException("无法读取所选文件。");
            int max = Math.min(24000000, Math.max(1, call.getInt("maxBytes", 24000000)));
            call.resolve(new JSObject().put("text", new String(readLimited(input, max), StandardCharsets.UTF_8)));
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    private class Request {
        volatile boolean cancelled;
        volatile HttpURLConnection connection;
        void cancel() { cancelled = true; if (connection != null) connection.disconnect(); }
    }

    private void emit(String id, String type, JSObject data) {
        data.put("id", id); data.put("type", type); notifyListeners("httpEvent", data);
    }

    @PluginMethod public void startHttp(PluginCall call) {
        String id = call.getString("id");
        if (id == null || requests.size() >= 8) { call.reject("请求过多，请稍后重试。"); return; }
        Request request = new Request();
        if (requests.putIfAbsent(id, request) != null) { call.reject("请求编号重复。"); return; }
        call.resolve();
        network.execute(() -> {
            try {
                URI uri = new URI(call.getString("url", ""));
                if (!("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) || uri.getUserInfo() != null) throw new IOException("接口地址无效。");
                if (request.cancelled) return;
                HttpURLConnection conn = (HttpURLConnection) uri.toURL().openConnection(); request.connection = conn;
                conn.setInstanceFollowRedirects(false); conn.setConnectTimeout(30000); conn.setReadTimeout(120000);
                conn.setRequestMethod(call.getString("method", "POST"));
                JSObject headers = call.getObject("headers", new JSObject());
                Iterator<String> names = headers.keys();
                while (names.hasNext()) {
                    String name = names.next();
                    if (name.equalsIgnoreCase("host") || name.equalsIgnoreCase("content-length") || name.equalsIgnoreCase("connection")) continue;
                    conn.setRequestProperty(name, headers.getString(name));
                }
                conn.setRequestProperty("Accept-Encoding", "identity");
                String body = call.getString("body", "");
                if (!body.isEmpty()) {
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    if (bytes.length > 8 * 1024 * 1024) throw new IOException("请求内容过大。");
                    conn.setDoOutput(true); conn.setFixedLengthStreamingMode(bytes.length);
                    if (request.cancelled) return;
                    try (OutputStream output = conn.getOutputStream()) { output.write(bytes); }
                }
                if (request.cancelled) return;
                int code = conn.getResponseCode();
                if (code >= 300 && code < 400) throw new IOException("接口发生重定向，请填写最终接口地址。");
                JSObject responseHeaders = new JSObject();
                for (Map.Entry<String, List<String>> header : conn.getHeaderFields().entrySet()) if (header.getKey() != null) responseHeaders.put(header.getKey(), String.join(", ", header.getValue()));
                emit(id, "headers", new JSObject().put("status", code).put("headers", responseHeaders));
                InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
                if (stream != null) try (InputStream input = stream) {
                    byte[] buffer = new byte[8192]; int length, total = 0;
                    while (!request.cancelled && (length = input.read(buffer)) != -1) {
                        total += length; if (total > 32 * 1024 * 1024) throw new IOException("接口回复过大。");
                        emit(id, "data", new JSObject().put("data", Base64.encodeToString(buffer, 0, length, Base64.NO_WRAP)));
                    }
                }
                if (!request.cancelled) emit(id, "end", new JSObject());
            } catch (Exception error) {
                if (!request.cancelled) emit(id, "error", new JSObject().put("message", "连接失败：" + error.getClass().getSimpleName()));
            } finally { request.cancel(); requests.remove(id); }
        });
    }

    @PluginMethod public void cancelHttp(PluginCall call) {
        Request request = requests.get(call.getString("id", "")); if (request != null) request.cancel(); call.resolve();
    }

    @Override protected void handleOnDestroy() {
        destroyed = true;
        for (Request request : requests.values()) request.cancel(); network.shutdownNow();
        if (speech != null) { speech.stop(); speech.shutdown(); }
        for (String id : speeches.keySet()) finishSpeech(id, "应用已关闭。");
    }
}

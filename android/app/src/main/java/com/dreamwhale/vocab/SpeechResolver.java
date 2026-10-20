package com.dreamwhale.vocab;

import java.util.*;

final class SpeechResolver {
    record Choice(String id, String name, Locale locale, Boolean local, boolean installed) {}
    interface Engine {
        List<Choice> voices();
        boolean setVoice(String id);
        Choice setLanguage(Locale locale);
    }

    static boolean matches(Locale actual, Locale wanted) {
        return actual != null && actual.getLanguage().equalsIgnoreCase(wanted.getLanguage())
            && actual.getCountry().equalsIgnoreCase(wanted.getCountry());
    }

    static Choice resolve(Engine engine, String accent, boolean offline) {
        if (!accent.equals("en-US") && !accent.equals("en-GB")) throw new IllegalArgumentException("请选择英式或美式英语。");
        Locale wanted = Locale.forLanguageTag(accent);
        List<Choice> candidates = new ArrayList<>();
        try {
            List<Choice> available = engine.voices();
            if (available != null) for (Choice voice : available) {
                if (voice.installed() && matches(voice.locale(), wanted) && (!offline || Boolean.TRUE.equals(voice.local()))) candidates.add(voice);
            }
        } catch (RuntimeException ignored) {}
        candidates.sort(Comparator.comparingInt((Choice v) -> Boolean.TRUE.equals(v.local()) ? 0 : 1).thenComparing(Choice::id));
        for (Choice voice : candidates) {
            try { if (engine.setVoice(voice.id())) return voice; } catch (RuntimeException ignored) {}
        }
        Choice fallback = null;
        try { fallback = engine.setLanguage(wanted); } catch (RuntimeException ignored) {}
        if (fallback != null && fallback.installed() && fallback.locale() != null
            && fallback.locale().getLanguage().equalsIgnoreCase("en")
            && (!offline || Boolean.TRUE.equals(fallback.local()))) return fallback;
        throw new IllegalStateException(offline
            ? "没有确认可用的离线英语声音。可关闭“仅使用离线语音”尝试系统声音，或安装英语离线语音包。"
            : "系统暂时无法朗读英语，请检查手机的文字转语音服务后重试。");
    }
}

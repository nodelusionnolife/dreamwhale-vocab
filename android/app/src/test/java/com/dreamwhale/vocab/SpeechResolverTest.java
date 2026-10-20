package com.dreamwhale.vocab;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;

public class SpeechResolverTest {
    private static SpeechResolver.Choice voice(String id, Locale locale, Boolean local) {
        return new SpeechResolver.Choice(id, id, locale, local, true);
    }
    private static class Engine implements SpeechResolver.Engine {
        List<SpeechResolver.Choice> voices = List.of();
        SpeechResolver.Choice fallback;
        boolean failList;
        boolean failVoice;
        boolean languageUsed;
        public List<SpeechResolver.Choice> voices() { if (failList) throw new UnsupportedOperationException(); return voices; }
        public boolean setVoice(String id) { return !failVoice; }
        public SpeechResolver.Choice setLanguage(Locale locale) { languageUsed = true; return fallback; }
    }
    @Test public void emptyListCanUseLegacySystemEnglish() {
        Engine engine = new Engine(); engine.fallback = voice("system", Locale.ENGLISH, null);
        assertEquals("system", SpeechResolver.resolve(engine, "en-US", false).id());
        assertTrue(engine.languageUsed);
    }
    @Test public void exactLocalVoiceIsPreferredAndVariantsMatch() {
        Engine engine = new Engine();
        engine.voices = List.of(voice("network", Locale.US, false), voice("local", new Locale("en", "US", "POSIX"), true));
        assertEquals("local", SpeechResolver.resolve(engine, "en-US", false).id()); assertFalse(engine.languageUsed);
    }
    @Test public void onlineOnlyEngineWorksInAutoButNotOffline() {
        Engine engine = new Engine(); engine.fallback = voice("network", Locale.US, false); engine.voices = List.of(engine.fallback);
        assertEquals("network", SpeechResolver.resolve(engine, "en-US", false).id());
        assertThrows(IllegalStateException.class, () -> SpeechResolver.resolve(engine, "en-US", true));
    }
    @Test public void offlineFallbackMustBeConfirmedLocalAndReportsActualAccent() {
        Engine engine = new Engine(); engine.fallback = voice("system", Locale.ENGLISH, null);
        assertThrows(IllegalStateException.class, () -> SpeechResolver.resolve(engine, "en-GB", true));
        engine.fallback = voice("local-us", Locale.US, true);
        assertEquals(Locale.US, SpeechResolver.resolve(engine, "en-GB", true).locale());
    }
    @Test public void unavailableListingOrVoiceFallsBackWithoutChangingRequestedLanguage() {
        Engine engine = new Engine(); engine.failList = true; engine.fallback = voice("system", Locale.UK, true);
        assertEquals(Locale.UK, SpeechResolver.resolve(engine, "en-GB", false).locale());
        engine.failList = false; engine.failVoice = true; engine.voices = List.of(voice("unusable", Locale.UK, true));
        assertEquals("system", SpeechResolver.resolve(engine, "en-GB", false).id());
    }
    @Test public void missingDataAndNonEnglishFallbackAreRejected() {
        Engine engine = new Engine(); engine.voices = List.of(new SpeechResolver.Choice("missing", "missing", Locale.US, true, false));
        assertThrows(IllegalStateException.class, () -> SpeechResolver.resolve(engine, "en-US", false));
        engine.fallback = voice("chinese", Locale.CHINA, true);
        assertThrows(IllegalStateException.class, () -> SpeechResolver.resolve(engine, "en-US", false));
        assertThrows(IllegalArgumentException.class, () -> SpeechResolver.resolve(engine, "fr-FR", false));
    }
}

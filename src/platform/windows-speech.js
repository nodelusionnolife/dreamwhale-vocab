export function createWindowsSpeech(invoke) {
  let generation = 0;
  let cancel = null;
  return {
    stopSpeech() { generation++; cancel?.(); cancel = null; },
    async speak(text, options) {
      const request = generation;
      const buffer = await invoke('synthesize_speech', { text, voiceId: options.voiceId, rate: options.speechRate, lang: options.speechAccent });
      if (request !== generation) return;
      const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: 'audio/wav' }));
      const audio = new Audio(url);
      await new Promise((resolve, reject) => {
        let timer;
        const finish = error => {
          clearTimeout(timer); audio.onended = audio.onerror = null; audio.pause(); audio.removeAttribute('src'); URL.revokeObjectURL(url);
          if (cancel === stop) cancel = null;
          error ? reject(error) : resolve();
        };
        const stop = () => finish(); cancel = stop;
        audio.onended = () => finish(); audio.onerror = () => finish(new Error('读音播放失败，请检查系统音频输出。'));
        timer = setTimeout(() => finish(new Error('朗读超时，请重试。')), 90000);
        audio.play().catch(error => finish(new Error(`无法播放读音：${error.message}`)));
      });
    },
  };
}

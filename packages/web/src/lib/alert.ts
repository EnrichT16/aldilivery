/**
 * Getting attention when a Runner's question arrives on an open page: a two-note chime and a
 * buzz. Neither is the only signal — the question is also an alert a screen reader says, and it
 * is on the screen — so either may quietly fail: a browser can refuse sound until the page has
 * been pressed once, and most computers cannot vibrate.
 *
 * The chime is made here rather than loaded as a file, so there is nothing to download or cache.
 */

type AudioContextConstructor = typeof AudioContext;

export function chime(): void {
  try {
    const Context: AudioContextConstructor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
    if (!Context) return;
    const audio = new Context();
    const start = audio.currentTime;
    // Two notes, rising: friendly rather than alarming, and long enough to notice.
    [
      { frequency: 660, at: 0 },
      { frequency: 880, at: 0.28 },
    ].forEach(({ frequency, at }) => {
      const tone = audio.createOscillator();
      const volume = audio.createGain();
      tone.type = 'sine';
      tone.frequency.value = frequency;
      volume.gain.setValueAtTime(0.0001, start + at);
      volume.gain.exponentialRampToValueAtTime(0.4, start + at + 0.03);
      volume.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.45);
      tone.connect(volume).connect(audio.destination);
      tone.start(start + at);
      tone.stop(start + at + 0.5);
    });
    window.setTimeout(() => {
      void audio.close();
    }, 1500);
  } catch {
    // No sound. The alert and the screen still say it.
  }
}

export function buzz(): void {
  try {
    navigator.vibrate?.([300, 150, 300]);
  } catch {
    // No vibration on this device.
  }
}

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

/**
 * A short click, like a camera shutter: something has been taken in (Anthony, 6 October 2026:
 * "it should make a sound ... to show that it's been captured"). Used when a card box is filled.
 */
export function click(): void {
  try {
    const Context: AudioContextConstructor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
    if (!Context) return;
    const audio = new Context();
    const start = audio.currentTime;
    const tone = audio.createOscillator();
    const volume = audio.createGain();
    tone.type = 'square';
    tone.frequency.value = 1400;
    volume.gain.setValueAtTime(0.3, start);
    volume.gain.exponentialRampToValueAtTime(0.0001, start + 0.06);
    tone.connect(volume).connect(audio.destination);
    tone.start(start);
    tone.stop(start + 0.07);
    window.setTimeout(() => {
      void audio.close();
    }, 500);
  } catch {
    // No sound. Ozi still says it.
  }
}

function tones(
  notes: Array<{ frequency: number; at: number; length: number; type?: OscillatorType }>,
): void {
  try {
    const Context: AudioContextConstructor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
    if (!Context) return;
    const audio = new Context();
    const start = audio.currentTime;
    for (const { frequency, at, length, type } of notes) {
      const tone = audio.createOscillator();
      const volume = audio.createGain();
      tone.type = type ?? 'triangle';
      tone.frequency.value = frequency;
      volume.gain.setValueAtTime(0.0001, start + at);
      volume.gain.exponentialRampToValueAtTime(0.35, start + at + 0.01);
      volume.gain.exponentialRampToValueAtTime(0.0001, start + at + length);
      tone.connect(volume).connect(audio.destination);
      tone.start(start + at);
      tone.stop(start + at + length + 0.05);
    }
    window.setTimeout(() => {
      void audio.close();
    }, 1500);
  } catch {
    // No sound. The words on the screen, and Ozi, still say it.
  }
}

/**
 * Money leaving: a till's "ka-ching" when a payment goes through (Anthony, 7 October 2026). Two
 * bright bell notes, a high one after a low one.
 */
export function moneyOut(): void {
  tones([
    { frequency: 1318, at: 0, length: 0.12 },
    { frequency: 1760, at: 0.09, length: 0.5 },
  ]);
}

/** Money coming back: a refund or gift card money, three falling coins. */
export function moneyIn(): void {
  tones([
    { frequency: 1976, at: 0, length: 0.15 },
    { frequency: 1568, at: 0.12, length: 0.15 },
    { frequency: 1318, at: 0.24, length: 0.4 },
  ]);
}

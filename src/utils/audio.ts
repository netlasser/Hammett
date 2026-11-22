let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new Ctx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

export function playJarvisChime(kind: 'activate' | 'confirm' | 'reminder'): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const playTone = (freq: number, startOffset: number, duration: number, gainPeak: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + startOffset);
    gain.gain.setValueAtTime(0.0001, now + startOffset);
    gain.gain.exponentialRampToValueAtTime(gainPeak, now + startOffset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + startOffset);
    osc.stop(now + startOffset + duration + 0.02);
  };

  if (kind === 'activate') {
    playTone(587.33, 0, 0.07, 0.04);
    playTone(880, 0.035, 0.09, 0.035);
  } else if (kind === 'confirm') {
    playTone(523.25, 0, 0.12, 0.035);
    playTone(659.25, 0.07, 0.14, 0.035);
    playTone(1046.5, 0.14, 0.22, 0.03);
  } else {
    playTone(659.25, 0, 0.18, 0.05);
    playTone(880, 0.15, 0.25, 0.05);
    playTone(659.25, 0.36, 0.18, 0.04);
  }
}

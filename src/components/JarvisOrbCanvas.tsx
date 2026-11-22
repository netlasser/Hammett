import { useEffect, useRef } from 'react';

export type JarvisStatus = 'idle' | 'listening' | 'thinking' | 'speaking';

interface JarvisOrbCanvasProps {
  status: JarvisStatus;
  amplitudeRef: { current: number };
}

export function JarvisOrbCanvas({ status, amplitudeRef }: JarvisOrbCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const statusRef = useRef<JarvisStatus>(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let animId = 0;
    let phase = 0;
    let smoothedAmp = 0;

    const renderFrame = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const size = 128;
      if (canvas.width !== size * dpr || canvas.height !== size * dpr) {
        canvas.width = size * dpr;
        canvas.height = size * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2;
      const currentStatus = statusRef.current;
      const targetAmp = amplitudeRef.current;
      smoothedAmp = smoothedAmp * 0.78 + targetAmp * 0.22;

      if (!prefersReducedMotion) {
        phase +=
          currentStatus === 'thinking'
            ? 0.04
            : currentStatus === 'speaking'
              ? 0.028
              : currentStatus === 'listening'
                ? 0.022
                : 0.006;
      }

      const rgb =
        currentStatus === 'listening'
          ? '56, 189, 248'
          : currentStatus === 'thinking'
            ? '245, 158, 11'
            : currentStatus === 'speaking'
              ? '125, 211, 252'
              : '163, 163, 163';

      // Fine outer reference ring
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${rgb}, ${currentStatus === 'idle' ? 0.22 : 0.45})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 48 + smoothedAmp * 5, 0, Math.PI * 2);
      ctx.stroke();

      // Rotating segmented arc
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = `rgba(${rgb}, ${currentStatus === 'idle' ? 0.35 : 0.75})`;
      const midRadius = 38 + smoothedAmp * 3;
      for (let i = 0; i < 3; i++) {
        const start = phase + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(cx, cy, midRadius, start, start + Math.PI * 0.38);
        ctx.stroke();
      }

      // Minimal radial acoustic ticks
      const barCount = 32;
      const baseR = 23;
      ctx.lineWidth = 1.25;
      ctx.lineCap = 'round';
      for (let i = 0; i < barCount; i++) {
        const angle = (i / barCount) * Math.PI * 2 + phase * 0.2;
        const harmonic =
          Math.sin(i * 0.7 + phase * 4) * 0.5 +
          Math.cos(i * 1.3 - phase * 3) * 0.5;
        const barLen =
          currentStatus === 'idle'
            ? 2
            : currentStatus === 'thinking'
              ? 3.5 + Math.abs(harmonic) * 4
              : 2.5 + smoothedAmp * (9 + Math.abs(harmonic) * 11);

        ctx.strokeStyle = `rgba(${rgb}, ${currentStatus === 'idle' ? 0.35 : 0.85})`;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * baseR, cy + Math.sin(angle) * baseR);
        ctx.lineTo(
          cx + Math.cos(angle) * (baseR + barLen),
          cy + Math.sin(angle) * (baseR + barLen),
        );
        ctx.stroke();
      }

      // Quiet center ring
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${rgb}, 0.7)`;
      ctx.beginPath();
      ctx.arc(cx, cy, 14 + smoothedAmp * 2.5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();

      if (!prefersReducedMotion) {
        animId = requestAnimationFrame(renderFrame);
      }
    };

    renderFrame();

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [amplitudeRef]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="jarvis-orb"
      data-status={status}
      aria-label={`Jarvis acoustic status: ${status}`}
      className="h-[128px] w-[128px]"
    />
  );
}

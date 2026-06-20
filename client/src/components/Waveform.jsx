import { useEffect, useRef } from 'react';

/**
 * Draws a live bar-style waveform from a MediaStream's audio levels.
 * This is the one piece of genuinely true real-time feedback in the whole
 * app: if these bars are moving, audio is flowing right now. No need to
 * say "Connected" anywhere near it — the motion says it.
 */
export function Waveform({ stream, color = '#4fd1c5', barCount = 28, idle = false }) {
  const canvasRef = useRef(null);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!stream) return;

    const canvas = canvasRef.current;
    const ctx2d = canvas.getContext('2d');
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtxRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const step = Math.floor(bufferLength / barCount);

    function draw() {
      rafRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      const { width, height } = canvas;
      ctx2d.clearRect(0, 0, width, height);

      const barWidth = width / barCount;
      const gap = barWidth * 0.35;

      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step] || 0;
        const barHeight = Math.max(3, (value / 255) * height);
        const x = i * barWidth;
        const y = height - barHeight;

        ctx2d.fillStyle = color;
        ctx2d.globalAlpha = 0.55 + (value / 255) * 0.45;
        roundedRect(ctx2d, x + gap / 2, y, barWidth - gap, barHeight, 2);
      }
    }

    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      source.disconnect();
      analyser.disconnect();
      audioCtx.close();
    };
  }, [stream, color, barCount]);

  return (
    <canvas
      ref={canvasRef}
      width={280}
      height={64}
      style={{
        width: '100%',
        height: 64,
        opacity: idle ? 0.25 : 1,
        transition: 'opacity 0.3s ease',
      }}
      aria-hidden="true"
    />
  );
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  ctx.fill();
}

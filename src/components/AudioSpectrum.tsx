import { useCallback, useEffect, useRef, useState } from "react";

interface AudioSpectrumProps {
  src: string;
  height?: number;
  disabled?: boolean;
}

/**
 * Simple frequency spectrum visualizer using Web Audio API + canvas.
 * - Renders a <canvas> bar spectrum that reacts to the audio.
 * - Shows an <audio> element with controls under it.
 */
export function AudioSpectrum({ src, height = 80, disabled = false }: AudioSpectrumProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef(0);
  const seekingRef = useRef(false);

  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (disabled) return;

    const audioEl = audioRef.current;
    const canvas = canvasRef.current;
    if (!audioEl || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const AudioContextClass = window.AudioContext || (window as unknown as {
      webkitAudioContext: typeof AudioContext;
    }).webkitAudioContext;
    const audioCtx = new AudioContextClass();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.82;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const source = audioCtx.createMediaElementSource(audioEl);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);

    let animationFrameId = 0;

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth || canvas.parentElement?.clientWidth || 640;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const drawFrame = () => {
      analyser.getByteFrequencyData(dataArray);

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.clearRect(0, 0, width, h);

      const bg = ctx.createLinearGradient(0, 0, width, h);
      bg.addColorStop(0, "rgba(15, 23, 42, 0.98)");
      bg.addColorStop(0.5, "rgba(8, 47, 73, 0.55)");
      bg.addColorStop(1, "rgba(49, 46, 129, 0.45)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, h);

      ctx.strokeStyle = "rgba(148, 163, 184, 0.12)";
      ctx.lineWidth = 1;
      for (let y = 12; y < h; y += 18) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      const bands = 92;
      const step = Math.max(1, Math.floor(bufferLength / bands));
      const gap = 2;
      const barWidth = Math.max(2, (width - gap * (bands - 1)) / bands);
      const centerY = h * 0.58;
      const maxHeight = h * 0.46;
      const fill = ctx.createLinearGradient(0, 0, width, 0);
      fill.addColorStop(0, "rgba(56, 189, 248, 0.95)");
      fill.addColorStop(0.45, "rgba(52, 211, 153, 0.92)");
      fill.addColorStop(1, "rgba(244, 114, 182, 0.9)");
      ctx.fillStyle = fill;
      ctx.shadowColor = "rgba(56, 189, 248, 0.32)";
      ctx.shadowBlur = 10;

      for (let band = 0; band < bands; band++) {
        let total = 0;
        for (let offset = 0; offset < step; offset++) {
          total += dataArray[Math.min(bufferLength - 1, band * step + offset)];
        }
        const value = total / step;
        const eased = Math.pow(value / 255, 0.72);
        const barHeight = Math.max(2, eased * maxHeight);
        const x = band * (barWidth + gap);
        ctx.fillRect(x, centerY - barHeight, barWidth, barHeight);
        ctx.globalAlpha = 0.42;
        ctx.fillRect(x, centerY + 2, barWidth, barHeight * 0.5);
        ctx.globalAlpha = 1;
      }

      ctx.shadowBlur = 0;
      const px = progressRef.current * width;
      ctx.fillStyle = "rgba(248, 250, 252, 0.95)";
      ctx.fillRect(px, 0, 2, h);
      ctx.fillStyle = "rgba(248, 250, 252, 0.18)";
      ctx.fillRect(0, centerY, width, 1);
    };

    const render = () => {
      drawFrame();
      animationFrameId = requestAnimationFrame(render);
    };

    const startRender = () => {
      if (!animationFrameId) {
        render();
      }
    };

    const stopRender = () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = 0;
      }
      drawFrame();
    };

    const handlePlay = () => {
      if (audioCtx.state === "suspended") {
        audioCtx.resume();
      }
      startRender();
    };

    const handlePause = () => {
      stopRender();
    };

    audioEl.addEventListener("play", handlePlay);
    audioEl.addEventListener("pause", handlePause);
    audioEl.addEventListener("ended", handlePause);
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();
    drawFrame();

    // clean up
    return () => {
      stopRender();
      audioEl.removeEventListener("play", handlePlay);
      audioEl.removeEventListener("pause", handlePause);
      audioEl.removeEventListener("ended", handlePause);
      window.removeEventListener("resize", resizeCanvas);
      try {
        source.disconnect();
        analyser.disconnect();
        audioCtx.close();
      } catch {
        // ignore
      }
    };
  }, [disabled, height]);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;

    const handleTime = () => {
      if (!audioEl.duration || Number.isNaN(audioEl.duration)) return;
      const ratio = Math.min(Math.max(audioEl.currentTime / audioEl.duration, 0), 1);
      progressRef.current = ratio;
      setProgress(ratio);
    };

    audioEl.addEventListener("timeupdate", handleTime);
    audioEl.addEventListener("loadedmetadata", handleTime);
    audioEl.addEventListener("ended", handleTime);

    return () => {
      audioEl.removeEventListener("timeupdate", handleTime);
      audioEl.removeEventListener("loadedmetadata", handleTime);
      audioEl.removeEventListener("ended", handleTime);
    };
  }, [src]);

  const seekToPointer = useCallback((clientX: number) => {
    const audioEl = audioRef.current;
    const canvas = canvasRef.current;
    if (!audioEl || !canvas || !audioEl.duration || Number.isNaN(audioEl.duration)) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    audioEl.currentTime = ratio * audioEl.duration;
    progressRef.current = ratio;
    setProgress(ratio);
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    seekingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekToPointer(event.clientX);
  }, [disabled, seekToPointer]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!seekingRef.current || disabled) return;
    seekToPointer(event.clientX);
  }, [disabled, seekToPointer]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    seekingRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* noop */
    }
  }, [disabled]);

  const canvasClassName = disabled
    ? "w-full rounded-sm bg-slate-950 cursor-not-allowed opacity-70"
    : "w-full touch-none rounded-sm bg-slate-950 cursor-pointer";

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-white/10 bg-black/60 p-2">
        <canvas
          ref={canvasRef}
          height={height}
          style={{ height }}
          className={canvasClassName}
          aria-label="Audio spectrum and seek control"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
        <div className="mt-1 text-right text-[10px] text-slate-400">{Math.round(progress * 100)}%</div>
      </div>
      <audio ref={audioRef} src={src} controls className="w-full" crossOrigin="anonymous" />
    </div>
  );
}

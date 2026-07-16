import { useEffect, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

const sizeMap = {
  sm: "44px",
  md: "260px",
  lg: "320px",
};

const VANISH_AFTER_CLICKS = 10;
const BASE_DEGREES_PER_SECOND = 360 / 17;
const FASTEST_DEGREES_PER_SECOND = 360 / 0.12;
const SPEED_MULTIPLIER = 1.62;

type PrismLogoProps = {
  className?: string;
  size?: keyof typeof sizeMap;
  showWordmark?: boolean;
  stableAxis?: boolean;
};

type PrismStyle = CSSProperties & {
  "--prism-size"?: string;
  "--prism-heat"?: string;
  "--prism-hue-shift"?: string;
  "--prism-saturation"?: string;
  "--prism-brightness"?: string;
  "--prism-glow-alpha"?: string;
  "--prism-core-tilt"?: string;
};

export function PrismLogo({ className, size = "md", showWordmark = true, stableAxis = false }: PrismLogoProps) {
  const coreRef = useRef<HTMLSpanElement>(null);
  const speedRef = useRef(BASE_DEGREES_PER_SECOND);
  const [spinLevel, setSpinLevel] = useState(0);
  const [overloaded, setOverloaded] = useState(false);
  const [vanished, setVanished] = useState(false);

  const resolvedSize = sizeMap[size] ?? sizeMap.md;
  const coreTilt = stableAxis ? "0deg" : "-12deg";
  const heat = Math.min(spinLevel / VANISH_AFTER_CLICKS, 1);
  const customStyle: PrismStyle = {
    "--prism-size": resolvedSize,
    "--prism-heat": heat.toFixed(2),
    "--prism-hue-shift": `${spinLevel * 28}deg`,
    "--prism-saturation": `${1 + heat * 1.25}`,
    "--prism-brightness": `${1 + heat * 0.3}`,
    "--prism-glow-alpha": `${0.35 + heat * 0.45}`,
    "--prism-core-tilt": coreTilt,
  };
  const frameStyle: CSSProperties = {
    width: resolvedSize,
    margin: showWordmark ? "20px auto" : "0",
  };

  useEffect(() => {
    if (!overloaded) return;

    const vanishTimer = window.setTimeout(() => {
      setVanished(true);
      toast.warning("Stop that funny shit.");
    }, 700);

    return () => window.clearTimeout(vanishTimer);
  }, [overloaded]);

  useEffect(() => {
    speedRef.current = overloaded
      ? FASTEST_DEGREES_PER_SECOND
      : Math.min(FASTEST_DEGREES_PER_SECOND, BASE_DEGREES_PER_SECOND * Math.pow(SPEED_MULTIPLIER, spinLevel));
  }, [overloaded, spinLevel]);

  useEffect(() => {
    let animationFrameId = 0;
    let previousTimestamp: number | null = null;
    let angle = 0;

    function rotate(timestamp: number) {
      if (previousTimestamp === null) {
        previousTimestamp = timestamp;
      }

      const deltaSeconds = Math.min((timestamp - previousTimestamp) / 1000, 0.05);
      previousTimestamp = timestamp;
      angle = (angle + speedRef.current * deltaSeconds) % 360;

      if (coreRef.current) {
        coreRef.current.style.transform = `rotateX(${coreTilt}) rotateY(${angle}deg)`;
      }

      animationFrameId = window.requestAnimationFrame(rotate);
    }

    animationFrameId = window.requestAnimationFrame(rotate);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [coreTilt]);

  function handlePrismClick() {
    if (overloaded || vanished) return;

    setSpinLevel((current) => {
      const nextSpinLevel = current + 1;
      if (nextSpinLevel >= VANISH_AFTER_CLICKS) {
        setOverloaded(true);
      }
      return nextSpinLevel;
    });
  }

  return (
    <div
      className={cn(
        "audio-prism-logo flex flex-col items-center gap-3",
        overloaded && "audio-prism-logo--overloaded",
        vanished && "audio-prism-logo--gone",
        className,
      )}
    >
      <div className="flex w-full flex-col items-center gap-3 justify-center" style={frameStyle}>
        <button
          type="button"
          className="audio-prism"
          style={customStyle}
          onClick={handlePrismClick}
          aria-label="Spin the AudioPrism logo faster"
          title="Spin the prism"
        >
          <span ref={coreRef} className="audio-prism__core">
            <span className="audio-prism__face audio-prism__face--front" />
            <span className="audio-prism__face audio-prism__face--right" />
            <span className="audio-prism__face audio-prism__face--left" />
          </span>
          <span className="audio-prism__halo" />
          <span className="audio-prism__reflection" />
        </button>
        {showWordmark && (
          <span className="block w-full text-center text-[0.6rem] font-semibold uppercase tracking-[0.5em] text-slate-200/80">
            AudioPrism
          </span>
        )}
      </div>
    </div>
  );
}

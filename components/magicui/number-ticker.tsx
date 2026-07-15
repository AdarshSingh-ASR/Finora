"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";

export function NumberTicker({ value, formatter = String, className }: { value: number; formatter?: (value: number) => string; className?: string }) {
  const previous = useRef(0);
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      previous.current = value;
      const reducedFrame = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(reducedFrame);
    }
    const startValue = previous.current, start = performance.now(), duration = 650;
    let frame = 0;
    const tick = (time: number) => {
      const progress = Math.min(1, (time - start) / duration), eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(startValue + (value - startValue) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick); else previous.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span className={cn("number-ticker", className)}>{formatter(display)}</span>;
}

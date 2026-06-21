"use client";

import { useEffect } from "react";
import { animate, useMotionValue, useTransform, motion } from "framer-motion";

/**
 * A number that tweens from its previous value to the next whenever `value`
 * changes — the count-up that gives the command-center metrics their life. The
 * displayed text is formatted through `format`, so the same component renders
 * compact currency ($4.5M), plain counts (20), or rates (0.0).
 */
export function AnimatedNumber({
  value,
  format,
  duration = 0.9,
  className,
}: {
  value: number;
  format: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const motionValue = useMotionValue(value);
  const display = useTransform(motionValue, (n) => format(n));

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration,
      ease: "easeOut",
    });
    return controls.stop;
  }, [value, duration, motionValue]);

  return <motion.span className={className}>{display}</motion.span>;
}

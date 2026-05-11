"use client";

import { useEffect, useState } from "react";

/**
 * Aviator-style analog clock in site palette.
 *
 * Layout draws inspiration from a classic Type B flieger:
 *   • Cream-ivory dial
 *   • Minute scale (5/10/15…55) around the edge, big and legible
 *   • Hour numerals (1–12) in a smaller inner ring
 *   • Triangle index at 12 for orientation
 *   • Slim hour + minute hands, gold sweep second hand with a
 *     counterweight tail
 *
 * No strap — just the round case and the two lugs (the strap-bar
 * tabs) sticking up and down so the watch reads as "a watch" even
 * without the leather band.
 *
 * Live: ticks every second via setInterval.  First render shows
 * 12:00:00 to avoid a server/client hydration mismatch on `Date`;
 * the effect kicks in immediately on mount.
 */
export function AnalogClock() {
  // Start with a stable, deterministic time so SSR markup matches
  // the first client render.  The useEffect below replaces it with
  // the real current time the moment we hit the browser.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // While the effect hasn't fired (very brief, < 1 frame), render
  // the hands at the 12:00:00 position so the static SVG is valid.
  const reference = now ?? new Date(2026, 0, 1, 12, 0, 0);
  const hours = reference.getHours() % 12;
  const minutes = reference.getMinutes();
  const seconds = reference.getSeconds();
  // Smooth interpolation — hour hand creeps with the minutes,
  // minute hand creeps with the seconds.  Skip on the second hand
  // so it does a proper tick-tick step.
  const hourAngle = (hours + minutes / 60) * 30;       // 12 hours × 30°
  const minuteAngle = (minutes + seconds / 60) * 6;    // 60 minutes × 6°
  const secondAngle = seconds * 6;                     // 60 seconds × 6°

  // Helper: project a hand-end point given a rotation about the
  // dial centre.  SVG uses cy-down, so we negate cosine.  Centre
  // sits at (150,150) — the viewBox is square now that the strap
  // lugs are gone.
  const project = (angleDeg: number, length: number, cx = 150, cy = 150) => {
    const rad = (angleDeg - 90) * (Math.PI / 180);
    return {
      x: cx + length * Math.cos(rad),
      y: cy + length * Math.sin(rad),
    };
  };

  const hourEnd = project(hourAngle, 62);
  const minuteEnd = project(minuteAngle, 92);
  const secondEnd = project(secondAngle, 102);
  const secondTail = project(secondAngle + 180, 22);

  return (
    <div className="flex items-center justify-center">
      <svg
        viewBox="0 0 300 300"
        className="w-full max-w-[440px] h-auto"
        role="img"
        aria-label={
          now
            ? `Текущее время: ${now.toLocaleTimeString("ru-RU")}`
            : "Аналоговые часы"
        }
      >
        {/* Case — outer metal ring.  Lugs removed by request; just
            the round body floats on the emerald background. */}
        <circle
          cx="150" cy="150" r="142"
          fill="rgba(250,246,233,0.10)"
          stroke="rgba(212,183,106,0.50)"
          strokeWidth="2"
        />
        {/* Case — inner bevel */}
        <circle
          cx="150" cy="150" r="132"
          fill="none"
          stroke="rgba(212,183,106,0.30)"
          strokeWidth="1"
        />

        {/* Dial face — cream ivory */}
        <circle cx="150" cy="150" r="125" fill="#FAF6E9" />

        {/* Minute ticks — 60 short marks; every 5th is longer + bolder */}
        {Array.from({ length: 60 }, (_, i) => {
          const angle = i * 6;
          const isMajor = i % 5 === 0;
          const outer = project(angle, 118);
          const inner = project(angle, isMajor ? 104 : 111);
          return (
            <line
              key={`tick-${i}`}
              x1={inner.x} y1={inner.y}
              x2={outer.x} y2={outer.y}
              stroke="#0D2E22"
              strokeWidth={isMajor ? 2 : 1}
              strokeLinecap="round"
            />
          );
        })}

        {/* Outer minute numerals — 5, 10, 15, …, 55 in the flieger
            style.  60 lives at the top under the triangle. */}
        {Array.from({ length: 12 }, (_, i) => {
          const minute = (i + 1) * 5;
          const angle = (i + 1) * 30;
          const pos = project(angle, 92);
          return (
            <text
              key={`min-${minute}`}
              x={pos.x} y={pos.y}
              fontFamily="var(--font-mono), monospace"
              fontWeight="500"
              fontSize="13"
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#0D2E22"
            >
              {minute === 60 ? "" : minute}
            </text>
          );
        })}

        {/* Triangle index at 12 — orientation cue, gold for brand */}
        <path
          d="M 144 50 L 156 50 L 150 64 Z"
          fill="#D4B76A"
          stroke="#0D2E22"
          strokeWidth="0.5"
        />

        {/* Inner hour ring — 1–12 numerals */}
        {Array.from({ length: 12 }, (_, i) => {
          const hour = i + 1;
          const angle = hour * 30;
          const pos = project(angle, 70);
          return (
            <text
              key={`hr-${hour}`}
              x={pos.x} y={pos.y}
              fontFamily="var(--font-fraunces), serif"
              fontWeight="500"
              fontSize="16"
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#0D2E22"
              opacity="0.85"
            >
              {hour}
            </text>
          );
        })}

        {/* Brand wordmark on the dial — tiny serif, sits between the
            hour ring and the centre.  Same restraint as on real
            watches that print the maker name. */}
        <text
          x="150" y="118"
          fontFamily="var(--font-fraunces), serif"
          fontStyle="italic"
          fontWeight="400"
          fontSize="11"
          textAnchor="middle"
          fill="#0D2E22"
          opacity="0.6"
        >
          Grimoire
        </text>

        {/* Hour hand — solid, blunt tip, dark for legibility */}
        <line
          x1="150" y1="150"
          x2={hourEnd.x} y2={hourEnd.y}
          stroke="#0D2E22"
          strokeWidth="6"
          strokeLinecap="round"
        />
        {/* Minute hand — slimmer + longer */}
        <line
          x1="150" y1="150"
          x2={minuteEnd.x} y2={minuteEnd.y}
          stroke="#0D2E22"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        {/* Second hand with counterweight tail — gold for pop */}
        <line
          x1={secondTail.x} y1={secondTail.y}
          x2={secondEnd.x} y2={secondEnd.y}
          stroke="#D4B76A"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        {/* Centre cap on top of all hands */}
        <circle cx="150" cy="150" r="6" fill="#D4B76A" stroke="#0D2E22" strokeWidth="1" />
        <circle cx="150" cy="150" r="1.7" fill="#0D2E22" />
      </svg>
    </div>
  );
}

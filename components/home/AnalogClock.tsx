"use client";

import { useEffect, useState } from "react";

/**
 * Aviator (Type-B flieger) clock, modelled exactly on the reference
 * watch shipped with the redesign brief:
 *
 *   • Warm cream dial, no branding text — the photo's face is
 *     blank apart from the numerals.
 *   • Outer minute scale 5 / 10 / 15 / … / 55 in bold sans (the
 *     photo uses a heavy black sans-serif).
 *   • Inner hour scale 1 / 2 / … / 12 in smaller serif numerals.
 *   • Triangle index at 12 with two flanking pip dots.
 *   • Three hands: hour and minute are sword-shaped with a cream
 *     tip (matches the photo's painted lume); second hand is a
 *     slim stick.
 *   • Crown protrudes from the case at 3 o'clock.
 *   • Strap lugs intentionally absent — case floats clean on the
 *     emerald background per request.
 *
 * Hands smooth-interpolate between ticks (hour creeps with the
 * minutes, minute creeps with the seconds).  Second hand does
 * discrete ticks once per second via setInterval(1000).  First
 * server render uses a deterministic 12:00:00 so SSR markup
 * matches the first client paint.
 */
export function AnalogClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const reference = now ?? new Date(2026, 0, 1, 12, 0, 0);
  const hours = reference.getHours() % 12;
  const minutes = reference.getMinutes();
  const seconds = reference.getSeconds();
  const hourAngle = (hours + minutes / 60) * 30;
  const minuteAngle = (minutes + seconds / 60) * 6;
  const secondAngle = seconds * 6;

  // Centre at (150,150).  SVG y grows downward, so we offset the
  // angle by -90° to put 0° at 12 o'clock.
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

  // Dial palette pulled from the reference photo:
  // - cream/tan face (#E9DDB1) — warm, slightly aged
  // - near-black markings (#1A1410) — readable on cream
  // - off-white painted hand tip (#F5EFD8)
  // - brushed-steel case (rgba ivory-mute) — matches the photo
  //   well enough on the emerald background.
  const DIAL = "#E9DDB1";
  const INK = "#1A1410";
  const LUME = "#F5EFD8";

  return (
    <div className="flex items-center justify-center">
      <svg
        viewBox="0 0 320 300"
        className="w-full max-w-[460px] h-auto"
        role="img"
        aria-label={
          now
            ? `Текущее время: ${now.toLocaleTimeString("ru-RU")}`
            : "Аналоговые часы"
        }
      >
        {/* Crown — small stem sticking out at 3 o'clock.  Drawn
            before the case so the case rim overlaps cleanly. */}
        <rect
          x="291" y="143"
          width="14" height="14"
          rx="2"
          fill="rgba(250,246,233,0.20)"
          stroke="rgba(212,183,106,0.45)"
          strokeWidth="1"
        />

        {/* Case — outer brushed-steel ring */}
        <circle
          cx="150" cy="150" r="142"
          fill="rgba(250,246,233,0.12)"
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

        {/* Dial */}
        <circle cx="150" cy="150" r="125" fill={DIAL} />

        {/* Minute ticks — 60 short marks; every 5th is longer + heavier */}
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
              stroke={INK}
              strokeWidth={isMajor ? 2.4 : 1}
              strokeLinecap="butt"
            />
          );
        })}

        {/* Outer minute numerals 5, 10, … 55.  The 60 position is
            taken by the triangle, so we skip it.  Bold mono — the
            photo's outer ring is a heavy sans, this is the closest
            match in our font stack. */}
        {Array.from({ length: 11 }, (_, i) => {
          const minute = (i + 1) * 5; // 5 .. 55
          const angle = (i + 1) * 30;
          const pos = project(angle, 91);
          return (
            <text
              key={`min-${minute}`}
              x={pos.x} y={pos.y}
              fontFamily="var(--font-mono), monospace"
              fontWeight="700"
              fontSize="15"
              textAnchor="middle"
              dominantBaseline="middle"
              fill={INK}
            >
              {minute}
            </text>
          );
        })}

        {/* Triangle index at 12 + two flanking pip dots — matches
            the reference photo's orientation cue exactly. */}
        <path
          d="M 144 46 L 156 46 L 150 62 Z"
          fill={LUME}
          stroke={INK}
          strokeWidth="1"
          strokeLinejoin="miter"
        />
        <circle cx="132" cy="56" r="1.8" fill={INK} />
        <circle cx="168" cy="56" r="1.8" fill={INK} />

        {/* Inner hour ring 1–12 — smaller serif numerals.  The
            photo's inner ring uses a thin serif; Fraunces reads
            close enough at this size. */}
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
              fontSize="13"
              textAnchor="middle"
              dominantBaseline="middle"
              fill={INK}
            >
              {hour}
            </text>
          );
        })}

        {/* Hour hand — sword shape with a cream lume tip.  Drawn
            as a polygon so we can give the tip a separate fill.
            Coordinates are computed via project() at three control
            points: base, shoulder, tip. */}
        <SwordHand
          angle={hourAngle}
          length={62}
          width={8}
          shoulder={0.78}
          ink={INK}
          lume={LUME}
        />

        {/* Minute hand — same construction, longer + slimmer */}
        <SwordHand
          angle={minuteAngle}
          length={96}
          width={6}
          shoulder={0.82}
          ink={INK}
          lume={LUME}
        />

        {/* Second hand — thin stick with a small counterweight tail.
            Tip painted black (no lume) per the photo. */}
        <line
          x1={secondTail.x} y1={secondTail.y}
          x2={secondEnd.x} y2={secondEnd.y}
          stroke={INK}
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <circle cx={secondTail.x} cy={secondTail.y} r="3.2" fill={INK} />

        {/* Centre cap on top of all hands */}
        <circle cx="150" cy="150" r="4" fill={INK} />
      </svg>
    </div>
  );
}

/**
 * Sword-shape watch hand — a thin diamond that broadens around the
 * midpoint and tapers back at the tip.  Drawn as a 6-point polygon
 * so we can plant a cream lume fill near the tip (separate from
 * the dark body).
 *
 * Geometry:
 *   • Base sits on the dial centre.
 *   • Body is `width` units wide at the widest point ("shoulder").
 *   • Shoulder sits at `shoulder` fraction of `length` along the
 *     hand axis.
 *   • Lume insert occupies the segment from `shoulder` → tip,
 *     drawn slightly narrower so a thin dark outline frames it.
 */
function SwordHand({
  angle,
  length,
  width,
  shoulder,
  ink,
  lume,
}: {
  angle: number;
  length: number;
  width: number;
  shoulder: number;
  ink: string;
  lume: string;
}) {
  const rad = (angle - 90) * (Math.PI / 180);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = 150;
  const cy = 150;

  // Forward axis = direction the hand points.
  // Side axis = perpendicular (rotated +90°).
  const fwd = (d: number) => ({ x: cos * d, y: sin * d });
  const side = (d: number) => ({ x: -sin * d, y: cos * d });

  const tip = fwd(length);
  const shoulderPt = fwd(length * shoulder);
  const baseBack = fwd(-width * 1.2); // small tail behind the centre

  // Body polygon: base-tail, shoulder-left, tip, shoulder-right.
  const half = width / 2;
  const baseL = { x: cx + side(-half).x, y: cy + side(-half).y };
  const baseR = { x: cx + side(half).x, y: cy + side(half).y };
  const shoulderL = { x: cx + shoulderPt.x + side(-half).x, y: cy + shoulderPt.y + side(-half).y };
  const shoulderR = { x: cx + shoulderPt.x + side(half).x, y: cy + shoulderPt.y + side(half).y };
  const tipPt = { x: cx + tip.x, y: cy + tip.y };
  const tailPt = { x: cx + baseBack.x, y: cy + baseBack.y };

  const bodyPath = `M ${tailPt.x} ${tailPt.y}
    L ${baseL.x} ${baseL.y}
    L ${shoulderL.x} ${shoulderL.y}
    L ${tipPt.x} ${tipPt.y}
    L ${shoulderR.x} ${shoulderR.y}
    L ${baseR.x} ${baseR.y} Z`;

  // Lume insert: slimmer rectangle from shoulder to tip.
  const lumeHalf = (width - 2) / 2;
  const lumeShoulderL = { x: cx + shoulderPt.x + side(-lumeHalf).x, y: cy + shoulderPt.y + side(-lumeHalf).y };
  const lumeShoulderR = { x: cx + shoulderPt.x + side(lumeHalf).x, y: cy + shoulderPt.y + side(lumeHalf).y };
  // Lume tip pulled in slightly so the outer dark outline frames it.
  const lumeTip = fwd(length - 2);
  const lumeTipPt = { x: cx + lumeTip.x, y: cy + lumeTip.y };

  const lumePath = `M ${lumeShoulderL.x} ${lumeShoulderL.y}
    L ${lumeTipPt.x} ${lumeTipPt.y}
    L ${lumeShoulderR.x} ${lumeShoulderR.y} Z`;

  return (
    <>
      <path d={bodyPath} fill={ink} stroke={ink} strokeWidth="0.5" strokeLinejoin="miter" />
      <path d={lumePath} fill={lume} stroke={ink} strokeWidth="0.5" strokeLinejoin="miter" />
    </>
  );
}

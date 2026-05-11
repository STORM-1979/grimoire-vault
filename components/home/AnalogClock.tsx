"use client";

import { useEffect, useState } from "react";

/**
 * Aviator (Type-B flieger) clock — layout and proportions copied
 * directly from the reference photo:
 *
 *   • Round case, no crown, no strap-lugs — the watch floats on
 *     the emerald background as a clean object.
 *   • Two-ring dial: outer minute scale (5/10/15/…/55) in heavy
 *     numerals, inner hour scale (1–12) in smaller numerals,
 *     separated by a thin hairline circle exactly as in the photo.
 *   • Triangle index at 12 with two flanking pip dots; apex points
 *     OUTWARD (toward the rim, away from centre).
 *   • Three sword-shaped hands with a cream lume tip.
 *
 * Dial reverts to the site's emerald palette per request — the
 * face is a slightly-lighter-than-background green so the watch
 * reads as an object instead of blending into the page.  Numerals
 * and hands in warm cream for contrast.
 *
 * Hands smooth-interpolate between ticks; second hand ticks
 * discretely once per second.  First server render uses a stable
 * 12:00:00 so SSR markup matches client.
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

  const project = (angleDeg: number, length: number, cx = 150, cy = 150) => {
    const rad = (angleDeg - 90) * (Math.PI / 180);
    return {
      x: cx + length * Math.cos(rad),
      y: cy + length * Math.sin(rad),
    };
  };

  const secondEnd = project(secondAngle, 102);
  const secondTail = project(secondAngle + 180, 22);

  // Palette — back to the site's emerald scheme.
  // - Dial: emerald just a step lighter than the page background
  //   so the case reads as a separate object.
  // - Ink: warm cream that contrasts on the green face.
  // - Accent: gold for the triangle index and the second hand.
  const DIAL = "#0F3528";
  const INK = "#E9DDB1";
  const ACCENT = "#D4B76A";

  return (
    <div className="flex items-center justify-center">
      <svg
        viewBox="0 0 300 300"
        className="w-full max-w-[540px] h-auto"
        role="img"
        aria-label={
          now
            ? `Текущее время: ${now.toLocaleTimeString("ru-RU")}`
            : "Аналоговые часы"
        }
      >
        {/* Case — outer brushed-steel ring */}
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

        {/* Dial — site emerald */}
        <circle cx="150" cy="150" r="125" fill={DIAL} />

        {/* Minute ticks — 60 short marks; every 5th is longer + heavier */}
        {Array.from({ length: 60 }, (_, i) => {
          const angle = i * 6;
          const isMajor = i % 5 === 0;
          const outer = project(angle, 119);
          const inner = project(angle, isMajor ? 104 : 112);
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

        {/* Outer minute numerals 5 / 10 / … / 55.  60 lives at the
            top under the triangle so we skip it.  Heavy mono — the
            closest match in our font stack to the reference photo's
            bold sans-serif. */}
        {Array.from({ length: 11 }, (_, i) => {
          const minute = (i + 1) * 5; // 5 .. 55
          const angle = (i + 1) * 30;
          const pos = project(angle, 90);
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

        {/* Thin hairline circle separating the outer minute ring
            from the inner hour ring.  Subtle — same colour as the
            ink at 40% opacity so it reads as a structural cue
            without competing with the numerals. */}
        <circle
          cx="150" cy="150" r="76"
          fill="none"
          stroke={INK}
          strokeWidth="0.8"
          opacity="0.45"
        />

        {/* Inner hour ring — 1–12 in smaller serif numerals,
            same ink colour as the outer ring but lighter weight. */}
        {Array.from({ length: 12 }, (_, i) => {
          const hour = i + 1;
          const angle = hour * 30;
          const pos = project(angle, 62);
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
              opacity="0.95"
            >
              {hour}
            </text>
          );
        })}

        {/* Triangle index at 12 — apex pointing OUTWARD (toward
            the rim) with two flanking pip dots, per the reference
            photo.  Wide base at y=62 (inner side), apex at y=46
            (outer side). */}
        <path
          d="M 144 62 L 156 62 L 150 46 Z"
          fill={ACCENT}
          stroke={INK}
          strokeWidth="0.6"
          strokeLinejoin="miter"
        />
        <circle cx="132" cy="56" r="1.8" fill={INK} />
        <circle cx="168" cy="56" r="1.8" fill={INK} />

        {/* Hour hand — sword shape with a cream body and gold lume
            tip.  Inverted contrast from the cream-dial photo (we
            need light hands on a dark dial), silhouette unchanged. */}
        <SwordHand
          angle={hourAngle}
          length={62}
          width={9}
          shoulder={0.78}
          body={INK}
          tip={ACCENT}
          outline={DIAL}
        />

        {/* Minute hand — longer + slimmer, same construction */}
        <SwordHand
          angle={minuteAngle}
          length={98}
          width={6.5}
          shoulder={0.84}
          body={INK}
          tip={ACCENT}
          outline={DIAL}
        />

        {/* Second hand — thin gold needle with a small dark
            counterweight tail, per the photo. */}
        <line
          x1={secondTail.x} y1={secondTail.y}
          x2={secondEnd.x} y2={secondEnd.y}
          stroke={ACCENT}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx={secondTail.x} cy={secondTail.y} r="3.4" fill={ACCENT} stroke={DIAL} strokeWidth="0.6" />

        {/* Centre cap on top of all hands */}
        <circle cx="150" cy="150" r="4.5" fill={ACCENT} stroke={DIAL} strokeWidth="0.8" />
      </svg>
    </div>
  );
}

/**
 * Sword-shape watch hand.  Six-point polygon: short tail behind
 * the centre, two shoulder corners at `shoulder` fraction along
 * the axis, and a single tip.  A second narrower polygon plants
 * a contrast tip near the end for the lume effect.
 *
 * `body` colour fills the broad diamond, `tip` colour fills the
 * lume insert near the end, and `outline` strokes around the
 * shapes — usually the dial colour so the hand reads cleanly
 * against the face.
 */
function SwordHand({
  angle,
  length,
  width,
  shoulder,
  body,
  tip,
  outline,
}: {
  angle: number;
  length: number;
  width: number;
  shoulder: number;
  body: string;
  tip: string;
  outline: string;
}) {
  const rad = (angle - 90) * (Math.PI / 180);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = 150;
  const cy = 150;

  const fwd = (d: number) => ({ x: cos * d, y: sin * d });
  const side = (d: number) => ({ x: -sin * d, y: cos * d });

  const shoulderPt = fwd(length * shoulder);
  const tipPt = fwd(length);
  const tailPt = fwd(-width * 1.3);

  const half = width / 2;
  const baseL = { x: cx + side(-half).x, y: cy + side(-half).y };
  const baseR = { x: cx + side(half).x, y: cy + side(half).y };
  const shoulderL = { x: cx + shoulderPt.x + side(-half).x, y: cy + shoulderPt.y + side(-half).y };
  const shoulderR = { x: cx + shoulderPt.x + side(half).x, y: cy + shoulderPt.y + side(half).y };
  const tipEnd = { x: cx + tipPt.x, y: cy + tipPt.y };
  const tailEnd = { x: cx + tailPt.x, y: cy + tailPt.y };

  const bodyPath = `M ${tailEnd.x} ${tailEnd.y}
    L ${baseL.x} ${baseL.y}
    L ${shoulderL.x} ${shoulderL.y}
    L ${tipEnd.x} ${tipEnd.y}
    L ${shoulderR.x} ${shoulderR.y}
    L ${baseR.x} ${baseR.y} Z`;

  // Lume insert — narrower diamond from shoulder to tip.
  const lumeHalf = Math.max(1.4, (width - 2.4) / 2);
  const lumeShoulderL = { x: cx + shoulderPt.x + side(-lumeHalf).x, y: cy + shoulderPt.y + side(-lumeHalf).y };
  const lumeShoulderR = { x: cx + shoulderPt.x + side(lumeHalf).x, y: cy + shoulderPt.y + side(lumeHalf).y };
  const lumeTipPt = fwd(length - 2);
  const lumeTip = { x: cx + lumeTipPt.x, y: cy + lumeTipPt.y };
  const lumePath = `M ${lumeShoulderL.x} ${lumeShoulderL.y}
    L ${lumeTip.x} ${lumeTip.y}
    L ${lumeShoulderR.x} ${lumeShoulderR.y} Z`;

  return (
    <>
      <path d={bodyPath} fill={body} stroke={outline} strokeWidth="0.7" strokeLinejoin="miter" />
      <path d={lumePath} fill={tip} stroke={outline} strokeWidth="0.5" strokeLinejoin="miter" />
    </>
  );
}

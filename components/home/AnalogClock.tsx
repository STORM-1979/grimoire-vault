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

  // Second hand reaches almost to the inner edge of the minute
  // scale so it visibly sweeps past each major tick — matches the
  // photo's needle proportions.
  const secondEndExtended = project(secondAngle, 115);
  const secondTail = project(secondAngle + 180, 24);

  // Palette — back to the site's emerald scheme.
  // - Dial: emerald just a step lighter than the page background
  //   so the case reads as a separate object.
  // - Ink: warm cream that contrasts on the green face.
  // - Accent: gold for the triangle index and the second hand.
  const DIAL = "#0F3528";
  const INK = "#E9DDB1";
  const ACCENT = "#D4B76A";

  return (
    <div className="flex items-center justify-center h-full w-full">
      <svg
        viewBox="0 0 300 300"
        // Scale by height to match the sibling calendar — the
        // homepage hero stretches both children to the same row
        // height via the grid's items-stretch, then this SVG fills
        // that height while preserving its 1:1 aspect.  max-h
        // pinned to the calendar's fixed height (440px) so the two
        // anchors stay visually balanced.
        className="h-full w-auto max-h-[440px] max-w-full"
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

        {/* Minute ticks — proportions remeasured against the photo:
            major ticks (every 5th) are longer + meaningfully heavier
            than the minors, which sit just inside the outer edge. */}
        {Array.from({ length: 60 }, (_, i) => {
          const angle = i * 6;
          const isMajor = i % 5 === 0;
          const outer = project(angle, 120);
          const inner = project(angle, isMajor ? 102 : 114);
          return (
            <line
              key={`tick-${i}`}
              x1={inner.x} y1={inner.y}
              x2={outer.x} y2={outer.y}
              stroke={INK}
              strokeWidth={isMajor ? 3 : 1}
              strokeLinecap="butt"
            />
          );
        })}

        {/* Outer minute numerals 5 / 10 / … / 55.  Bold mono, heavier
            than before — the photo's outer ring reads BIG. */}
        {Array.from({ length: 11 }, (_, i) => {
          const minute = (i + 1) * 5; // 5 .. 55
          const angle = (i + 1) * 30;
          const pos = project(angle, 89);
          return (
            <text
              key={`min-${minute}`}
              x={pos.x} y={pos.y}
              fontFamily="var(--font-mono), monospace"
              fontWeight="700"
              fontSize="17"
              textAnchor="middle"
              dominantBaseline="middle"
              fill={INK}
            >
              {minute}
            </text>
          );
        })}

        {/* Hairline separator between outer minute scale and inner
            hour ring.  Moved closer to centre (r=68 instead of 76)
            so the two scales sit at the right relative radii — the
            photo's separator divides the dial roughly in half by
            visual weight. */}
        <circle
          cx="150" cy="150" r="68"
          fill="none"
          stroke={INK}
          strokeWidth="0.8"
          opacity="0.45"
        />

        {/* Inner hour ring — 1–12 in small serif numerals, pulled
            closer to centre so the outer minute ring can breathe.
            Photo's inner ring is noticeably tighter to the centre
            than my previous pass had it. */}
        {Array.from({ length: 12 }, (_, i) => {
          const hour = i + 1;
          const angle = hour * 30;
          const pos = project(angle, 52);
          return (
            <text
              key={`hr-${hour}`}
              x={pos.x} y={pos.y}
              fontFamily="var(--font-fraunces), serif"
              fontWeight="500"
              fontSize="11"
              textAnchor="middle"
              dominantBaseline="middle"
              fill={INK}
              opacity="0.95"
            >
              {hour}
            </text>
          );
        })}

        {/* Triangle index at 12 — apex pointing OUTWARD with two
            flanking pip dots.  Bigger than before: 14 wide × 20
            tall, dots r=2.5. */}
        <path
          d="M 143 64 L 157 64 L 150 44 Z"
          fill={ACCENT}
          stroke={INK}
          strokeWidth="0.7"
          strokeLinejoin="miter"
        />
        <circle cx="130" cy="58" r="2.5" fill={INK} />
        <circle cx="170" cy="58" r="2.5" fill={INK} />

        {/* Hour hand — wider body with the diamond-shoulder sitting
            closer to the base (40% along instead of 78%), matching
            the photo's wedge silhouette where the widest point is
            near the centre pivot, then tapers to a sharp point. */}
        <SwordHand
          angle={hourAngle}
          length={62}
          width={11}
          shoulder={0.4}
          body={INK}
          tip={ACCENT}
          outline={DIAL}
        />

        {/* Minute hand — longer, slightly slimmer; same shoulder-
            near-base geometry. */}
        <SwordHand
          angle={minuteAngle}
          length={105}
          width={8}
          shoulder={0.42}
          body={INK}
          tip={ACCENT}
          outline={DIAL}
        />

        {/* Second hand — thin gold needle, longer (almost touches
            the inner edge of the minute scale), with a small dark
            counterweight tail. */}
        <line
          x1={secondTail.x} y1={secondTail.y}
          x2={secondEndExtended.x} y2={secondEndExtended.y}
          stroke={ACCENT}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx={secondTail.x} cy={secondTail.y} r="4" fill={ACCENT} stroke={DIAL} strokeWidth="0.6" />

        {/* Centre cap on top of all hands */}
        <circle cx="150" cy="150" r="5.5" fill={ACCENT} stroke={DIAL} strokeWidth="1" />
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

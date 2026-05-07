import type { IconName } from "@/lib/types";
import type { SVGProps } from "react";

/**
 * Single-source-of-truth line-icon set.
 * 24x24 viewBox, currentColor stroke, no fills unless noted.
 */

const PATHS: Record<IconName, React.ReactNode> = {
  documents: <g><path d="M7 4h7l5 5v11H7z" fill="none" strokeWidth="1.4"/><path d="M14 4v5h5" fill="none" strokeWidth="1.4"/><path d="M10 13h6M10 16h4" strokeWidth="1.4"/></g>,
  web:       <g><circle cx="12" cy="12" r="8" fill="none" strokeWidth="1.4"/><path d="M4 12h16M12 4c2.5 2.5 4 5.5 4 8s-1.5 5.5-4 8M12 4c-2.5 2.5-4 5.5-4 8s1.5 5.5 4 8" fill="none" strokeWidth="1.2"/></g>,
  youtube:   <g><rect x="3" y="6" width="18" height="12" rx="1.5" fill="none" strokeWidth="1.4"/><path d="M10 9.5l5 2.5-5 2.5z" fill="currentColor"/></g>,
  local:     <g><rect x="3" y="6" width="18" height="5" rx="1" fill="none" strokeWidth="1.4"/><rect x="3" y="13" width="18" height="5" rx="1" fill="none" strokeWidth="1.4"/><circle cx="7" cy="8.5" r=".8" fill="currentColor"/><circle cx="7" cy="15.5" r=".8" fill="currentColor"/></g>,
  designs:   <g><path d="M19 5l-9 9-3.5 1 1-3.5 9-9c.8-.8 2-.8 2.5 0z" fill="none" strokeWidth="1.4"/><path d="M14 7l3 3" strokeWidth="1.4"/></g>,
  images:    <g><rect x="3" y="5" width="18" height="14" rx="1.5" fill="none" strokeWidth="1.4"/><circle cx="9" cy="11" r="1.5" fill="currentColor"/><path d="M3 17l5-5 5 4 3-3 5 4" fill="none" strokeWidth="1.4"/></g>,
  skills:    <g><path d="M12 3l1.8 4 4.2.5-3 3 .8 4.5L12 13l-3.8 2 .8-4.5-3-3 4.2-.5z" fill="none" strokeWidth="1.4"/></g>,
  prompts:   <g><path d="M4 5h16v10H8l-4 4z" fill="none" strokeWidth="1.4"/><path d="M8 9h8M8 12h5" strokeWidth="1.4"/></g>,
  kanban:    <g><rect x="3" y="4" width="18" height="16" rx="1" fill="none" strokeWidth="1.4"/><path d="M9 4v16M15 4v16" strokeWidth="1.4"/><rect x="4.5" y="7" width="3" height="3" fill="currentColor"/><rect x="10.5" y="7" width="3" height="4" fill="currentColor" opacity=".5"/><rect x="16.5" y="7" width="3" height="2" fill="currentColor" opacity=".25"/></g>,
  ideas:     <g><path d="M12 3a6 6 0 0 0-3 11v3h6v-3a6 6 0 0 0-3-11z" fill="none" strokeWidth="1.4"/><path d="M10 20h4M10 22h4" strokeWidth="1.4"/></g>,
  portfolio: <g><rect x="3" y="7" width="18" height="13" rx="1" fill="none" strokeWidth="1.4"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" fill="none" strokeWidth="1.4"/><path d="M3 12h18" strokeWidth="1.4"/></g>,
  misc:      <g><circle cx="6" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="18" cy="12" r="1.5" fill="currentColor"/></g>,
  search:    <g><circle cx="11" cy="11" r="7" fill="none" strokeWidth="1.4"/><path d="M16 16l5 5" strokeWidth="1.4"/></g>,
  inbox:     <g><path d="M3 12h6l1 2h4l1-2h6" fill="none" strokeWidth="1.4"/><path d="M3 12V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5M3 12v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6" fill="none" strokeWidth="1.4"/></g>,
  settings:  <g><circle cx="12" cy="12" r="3" fill="none" strokeWidth="1.4"/><path d="M19 12c0 .5 0 1-.1 1.5l2 1.5-2 3.5-2.4-1c-.7.6-1.5 1-2.4 1.3l-.4 2.5h-4l-.4-2.5c-.9-.3-1.7-.7-2.4-1.3l-2.4 1-2-3.5 2-1.5C5.1 13 5 12.5 5 12s0-1 .1-1.5l-2-1.5 2-3.5 2.4 1c.7-.6 1.5-1 2.4-1.3l.4-2.5h4l.4 2.5c.9.3 1.7.7 2.4 1.3l2.4-1 2 3.5-2 1.5c.1.5.1 1 .1 1.5z" fill="none" strokeWidth="1.2"/></g>,
  add:       <g><path d="M12 5v14M5 12h14" strokeWidth="1.6"/></g>,
  arrow:     <g><path d="M5 12h14M13 6l6 6-6 6" fill="none" strokeWidth="1.4"/></g>,
  pin:       <g><path d="M12 2l4 4v6l3 4h-6v6h-2v-6H5l3-4V6z" fill="none" strokeWidth="1.4"/></g>,
  pinFilled: <g><path d="M12 2l4 4v6l3 4h-6v6h-2v-6H5l3-4V6z" fill="currentColor" strokeWidth="1"/></g>,
  star:      <g><path d="M12 3l2.6 5.6 6.4.7-4.8 4.4 1.4 6.3L12 17l-5.6 3 1.4-6.3L3 9.3l6.4-.7z" fill="none" strokeWidth="1.4"/></g>,
  play:      <g><path d="M8 5l11 7-11 7z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></g>,
  x:         <g><path d="M6 6l12 12M18 6L6 18" strokeWidth="1.6" strokeLinecap="round"/></g>,
  lock:      <g><rect x="5" y="11" width="14" height="9" rx="2" fill="none" strokeWidth="1.4"/><path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" strokeWidth="1.4"/><circle cx="12" cy="15.5" r="1.4" fill="currentColor"/></g>,
  eye:       <g><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" fill="none" strokeWidth="1.4"/><circle cx="12" cy="12" r="3" fill="none" strokeWidth="1.4"/></g>,
  eyeOff:    <g><path d="M3 3l18 18" strokeWidth="1.5"/><path d="M10.6 6.2c.5-.1 1-.2 1.4-.2 6.5 0 10 7 10 7-1 1.7-2.3 3.2-3.7 4.3M6.7 7.3C4 9.1 2 12 2 12s3.5 7 10 7c2.1 0 3.9-.7 5.4-1.7" fill="none" strokeWidth="1.4"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" fill="none" strokeWidth="1.4"/></g>,
  copy:      <g><rect x="8" y="8" width="12" height="12" rx="2" fill="none" strokeWidth="1.4"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" fill="none" strokeWidth="1.4"/></g>,
  check:     <g><path d="M5 12l5 5L20 7" fill="none" strokeWidth="1.6" strokeLinecap="round"/></g>,
  shield:    <g><path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6z" fill="none" strokeWidth="1.4"/><path d="M9 12l2 2 4-4" fill="none" strokeWidth="1.4"/></g>,
  refresh:   <g><path d="M4 4v6h6M20 20v-6h-6" fill="none" strokeWidth="1.4"/><path d="M20 10A8 8 0 0 0 6 6.5L4 9M4 14a8 8 0 0 0 14 3.5L20 15" fill="none" strokeWidth="1.4"/></g>,
  edit:      <g><path d="M14 4l6 6-9 9-6 1 1-6z" fill="none" strokeWidth="1.4"/><path d="M13 5l6 6" strokeWidth="1.4"/></g>,
  drag:      <g><circle cx="8" cy="6" r="1.4" fill="currentColor"/><circle cx="8" cy="12" r="1.4" fill="currentColor"/><circle cx="8" cy="18" r="1.4" fill="currentColor"/><circle cx="16" cy="6" r="1.4" fill="currentColor"/><circle cx="16" cy="12" r="1.4" fill="currentColor"/><circle cx="16" cy="18" r="1.4" fill="currentColor"/></g>,
  wifi:      <g><path d="M5 12.5a10 10 0 0 1 14 0M8 16a5 5 0 0 1 8 0" fill="none" strokeWidth="1.4"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/></g>,
  wifiOff:   <g><path d="M3 3l18 18" strokeWidth="1.5"/><path d="M5 12.5a10 10 0 0 1 5-2.5M14 10c2 .3 3.7 1.2 5 2.5" fill="none" strokeWidth="1.4"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/></g>,
  sort:      <g><path d="M7 5v14M3 9l4-4 4 4M17 19V5M13 15l4 4 4-4" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></g>,
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 20, className, ...rest }: IconProps) {
  const child = PATHS[name];
  if (!child) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      stroke="currentColor"
      fill="none"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {child}
    </svg>
  );
}

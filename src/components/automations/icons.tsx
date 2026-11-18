import type { ReactNode } from "react";

const Svg = ({ children }: { children: ReactNode }) => (
  <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
export const BoltIcon = () => <Svg><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></Svg>;
export const InstagramIcon = () => <Svg><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".6" /></Svg>;
export const ClockIcon = () => <Svg><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
export const WhatsappIcon = () => <Svg><path d="M21 12a9 9 0 0 1-13.5 7.8L3 21l1.3-4.3A9 9 0 1 1 21 12z" /><path d="M9 9.5c.5 2.5 2.5 4.5 5.5 5.5l1.2-1.4-2-1-1 .7c-.8-.4-1.5-1.1-1.9-1.9l.7-1-1-2z" /></Svg>;
export const BranchIcon = () => <Svg><path d="M6 3v6a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v4M6 3 3 6m3-3 3 3M18 21l-3-3m3 3 3-3" /></Svg>;
export const TaskIcon = () => <Svg><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.5 12 2.5 2.5 4.5-5" /></Svg>;
export const StopIcon = () => <Svg><path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z" /><path d="M9 12h6" /></Svg>;

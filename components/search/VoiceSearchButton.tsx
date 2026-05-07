"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/Icon";

/**
 * Microphone button that drives the search input via Web Speech API.
 *
 * Renders nothing on browsers that don't expose SpeechRecognition
 * (Safari/Firefox without flags) — failing silent is friendlier than
 * a "your browser doesn't support voice input" badge cluttering the
 * UI.  Recognition is set to `interimResults: false` and language
 * = "ru-RU" so we get one final transcript per session.  Click again
 * mid-listen to cancel.
 */
type SR = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: { 0: { transcript: string } }[] }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SRCtor = new () => SR;

declare global {
  interface Window {
    SpeechRecognition?: SRCtor;
    webkitSpeechRecognition?: SRCtor;
  }
}

export function VoiceSearchButton({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SR | null>(null);

  useEffect(() => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (Ctor) setSupported(true);
  }, []);

  if (!supported) return null;

  const toggle = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor = (window.SpeechRecognition ?? window.webkitSpeechRecognition) as SRCtor;
    const rec = new Ctor();
    rec.lang = "ru-RU";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const t = e.results[0]?.[0]?.transcript ?? "";
      if (t.trim()) onTranscript(t.trim());
    };
    rec.onerror = () => { setListening(false); };
    rec.onend = () => { setListening(false); recRef.current = null; };
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={listening ? "Слушаю… клик чтобы остановить" : "Голосовой поиск"}
      className={
        "flex items-center justify-center w-10 h-10 rounded-full transition " +
        (listening
          ? "bg-gold text-emerald-deep shadow-[0_0_0_4px_rgba(212,183,106,0.25)] animate-pulse"
          : "border border-white/15 text-ivory-mute hover:text-gold hover:border-gold/40")
      }
    >
      {/* Inline mic icon — no entry in the shared Icon catalogue. */}
      <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6" fill="none" aria-hidden>
        <rect x="9" y="3" width="6" height="12" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0" strokeLinecap="round" />
        <path d="M12 18v3" strokeLinecap="round" />
      </svg>
    </button>
  );
}

import { useEffect, useState } from "react";

const KEY = "pedalcast_session_v1";

export type PedalSession = { role: "admin" | "user"; password: string } | null;

export function loadSession(): PedalSession {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PedalSession;
  } catch {
    return null;
  }
}

export function saveSession(s: PedalSession) {
  if (typeof window === "undefined") return;
  if (s) localStorage.setItem(KEY, JSON.stringify(s));
  else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("pedalcast:session"));
}

export function usePedalSession(): [PedalSession, (s: PedalSession) => void] {
  const [s, setS] = useState<PedalSession>(null);
  useEffect(() => {
    setS(loadSession());
    const h = () => setS(loadSession());
    window.addEventListener("pedalcast:session", h);
    window.addEventListener("storage", h);
    return () => {
      window.removeEventListener("pedalcast:session", h);
      window.removeEventListener("storage", h);
    };
  }, []);
  return [s, (next) => { saveSession(next); setS(next); }];
}

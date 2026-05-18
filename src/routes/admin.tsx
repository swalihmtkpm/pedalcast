import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import {
  changePasswords,
  pushLocation,
  setBroadcastState,
} from "@/lib/pedalcast.functions";
import { loadSession, saveSession, usePedalSession } from "@/lib/usePedalSession";
import { startAdminBroadcast } from "@/lib/webrtcSignaling";
import { LiveMap } from "@/components/LiveMap";
import {
  Bike,
  CameraOff,
  Gauge,
  LogOut,
  Mic,
  Radio,
  Settings2,
  Square,
  Video,
} from "lucide-react";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
  head: () => ({ meta: [{ title: "Pedalcast · Admin Control" }] }),
});

function AdminPage() {
  const navigate = useNavigate();
  const [session] = usePedalSession();
  const setState = useServerFn(setBroadcastState);
  const push = useServerFn(pushLocation);

  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{
    lat: number;
    lng: number;
    speed: number | null;
    acc: number;
  } | null>(null);
  const [trail, setTrail] = useState<Array<[number, number]>>([]);
  const [kms, setKms] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [showSettings, setShowSettings] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const broadcastRef = useRef<{ stop: () => void } | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastPointRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    const s = loadSession();
    if (!s || s.role !== "admin") navigate({ to: "/" });
  }, [navigate]);

  // tick elapsed
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  async function start() {
    if (!session) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 } },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;

      broadcastRef.current = startAdminBroadcast(stream);
      await setState({ data: { password: session.password, isLive: true } });
      setLive(true);
      setStartedAt(Date.now());
      setTrail([]);
      setKms(0);
      lastPointRef.current = null;

      if ("geolocation" in navigator) {
        watchIdRef.current = navigator.geolocation.watchPosition(
          async (pos) => {
            const { latitude, longitude, accuracy, speed } = pos.coords;
            setCoords({
              lat: latitude,
              lng: longitude,
              acc: accuracy,
              speed: speed ?? null,
            });
            setTrail((t) => {
              const next = [...t, [latitude, longitude] as [number, number]];
              return next.length > 2000 ? next.slice(-2000) : next;
            });
            if (lastPointRef.current) {
              setKms((k) => k + haversineKm(lastPointRef.current!, { lat: latitude, lng: longitude }));
            }
            lastPointRef.current = { lat: latitude, lng: longitude };
            try {
              await push({
                data: {
                  password: session.password,
                  lat: latitude,
                  lng: longitude,
                  accuracy,
                  speed: speed ?? null,
                },
              });
            } catch { /* swallow transient */ }
          },
          (err) => setError(`GPS: ${err.message}`),
          { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
        );
      } else {
        setError("Geolocation not available on this device.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start broadcast");
      await stop();
    }
  }

  async function stop() {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    broadcastRef.current?.stop();
    broadcastRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setLive(false);
    setStartedAt(null);
    if (session) {
      try { await setState({ data: { password: session.password, isLive: false } }); } catch { /* ignore */ }
    }
  }

  useEffect(() => () => { void stop(); /* on unmount */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function logout() {
    void stop();
    saveSession(null);
    navigate({ to: "/" });
  }

  const speedKmh = coords?.speed != null ? Math.max(0, coords.speed * 3.6) : 0;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 md:px-6">
      <header className="flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Bike className="h-5 w-5" />
          </span>
          <span className="display text-xl">PEDALCAST · ADMIN</span>
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-secondary"
          >
            <Settings2 className="inline h-4 w-4" /> Settings
          </button>
          <button
            onClick={logout}
            className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-secondary"
          >
            <LogOut className="inline h-4 w-4" /> Log out
          </button>
        </div>
      </header>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      <div className="mt-6 grid gap-5 lg:grid-cols-[3fr_2fr]">
        {/* Camera */}
        <div className="relative aspect-video overflow-hidden rounded-2xl border border-border bg-black">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="h-full w-full object-cover"
          />
          {!live && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card/80 backdrop-blur">
              <CameraOff className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Camera off. Start broadcast to go live.
              </p>
            </div>
          )}
          {live && (
            <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-destructive px-3 py-1 text-xs font-semibold uppercase tracking-wider text-destructive-foreground pulse-live">
              <Radio className="h-3.5 w-3.5" /> LIVE
            </div>
          )}
        </div>

        {/* Map */}
        <div className="aspect-video lg:aspect-auto">
          <LiveMap lat={coords?.lat ?? null} lng={coords?.lng ?? null} trail={trail} />
        </div>
      </div>

      {/* Controls + Stats */}
      <div className="mt-5 grid gap-5 md:grid-cols-4">
        <Stat label="Distance" value={`${kms.toFixed(2)} km`} icon={<Bike className="h-4 w-4" />} />
        <Stat label="Speed" value={`${speedKmh.toFixed(1)} km/h`} icon={<Gauge className="h-4 w-4" />} />
        <Stat label="Elapsed" value={formatElapsed(elapsed)} icon={<Radio className="h-4 w-4" />} />
        <Stat
          label="GPS accuracy"
          value={coords ? `±${coords.acc.toFixed(0)} m` : "—"}
          icon={<Mic className="h-4 w-4" />}
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {!live ? (
          <button
            onClick={start}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground glow-lime transition hover:brightness-110"
          >
            <Video className="h-5 w-5" /> Start broadcast
          </button>
        ) : (
          <button
            onClick={stop}
            className="inline-flex items-center gap-2 rounded-xl bg-destructive px-6 py-3 font-semibold text-destructive-foreground transition hover:brightness-110"
          >
            <Square className="h-5 w-5" /> Stop broadcast
          </button>
        )}
        <p className="text-sm text-muted-foreground">
          Camera + microphone + GPS are streamed peer-to-peer. Nothing is stored.
        </p>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/70 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        {icon} {label}
      </div>
      <div className="display mt-2 text-3xl">{value}</div>
    </div>
  );
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [session] = usePedalSession();
  const change = useServerFn(changePasswords);
  const [currentAdmin, setCurrentAdmin] = useState("");
  const [newAdmin, setNewAdmin] = useState("");
  const [newUser, setNewUser] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await change({
        data: {
          currentAdmin,
          newAdmin: newAdmin || undefined,
          newUser: newUser || undefined,
        },
      });
      // If admin password rotated, refresh local session so further calls work
      if (newAdmin && session) {
        saveSession({ role: "admin", password: newAdmin });
      }
      setMsg("Saved.");
      setCurrentAdmin("");
      setNewAdmin("");
      setNewUser("");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-5 rounded-2xl border border-border bg-card/80 p-5 backdrop-blur"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="display text-xl">Change passwords</h2>
        <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">
          Close
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Current admin pass" value={currentAdmin} onChange={setCurrentAdmin} required />
        <Field label="New admin pass (optional)" value={newAdmin} onChange={setNewAdmin} />
        <Field label="New viewer pass (optional)" value={newUser} onChange={setNewUser} />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          disabled={busy || !currentAdmin || (!newAdmin && !newUser)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      <input
        type="password"
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono outline-none focus:border-primary"
      />
    </label>
  );
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

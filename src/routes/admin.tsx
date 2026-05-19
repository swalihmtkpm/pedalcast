import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  changePasswords,
  createRecordingUploadUrl,
  deleteRecording,
  listRecordingsAdmin,
  pushLocation,
  saveRecording,
  setBroadcastState,
  updateRecording,
} from "@/lib/pedalcast.functions";
import { loadSession, saveSession, usePedalSession } from "@/lib/usePedalSession";
import { startAdminBroadcast } from "@/lib/webrtcSignaling";
import { joinAsAdmin, playChime, type ChatMessage } from "@/lib/pedalRoom";
import { reverseGeocode } from "@/lib/reverseGeocode";
import { startRecorder, type RecorderHandle } from "@/lib/recorder";
import { LiveMap } from "@/components/LiveMap";
import {
  Bike,
  CameraOff,
  Check,
  Eye,
  EyeOff,
  Gauge,
  LogOut,
  MapPin,
  MessageCircle,
  Mic,
  Pencil,
  Radio,
  RefreshCw,
  Settings2,
  Square,
  Trash2,
  Video,
  X,
} from "lucide-react";

type FacingMode = "environment" | "user";

type AdminRecording = {
  id: string;
  title: string;
  storage_path: string;
  duration_seconds: number;
  distance_km: number;
  size_bytes: number;
  mime_type: string;
  started_at: string | null;
  ended_at: string | null;
  is_public: boolean;
  created_at: string;
  url: string;
};

export const Route = createFileRoute("/admin")({
  component: AdminPage,
  head: () => ({ meta: [{ title: "Pedalcast · Admin Control" }] }),
});

function AdminPage() {
  const navigate = useNavigate();
  const [session] = usePedalSession();
  const setState = useServerFn(setBroadcastState);
  const push = useServerFn(pushLocation);
  const signUpload = useServerFn(createRecordingUploadUrl);
  const persistRecording = useServerFn(saveRecording);
  const fetchRecordings = useServerFn(listRecordingsAdmin);
  const patchRecording = useServerFn(updateRecording);
  const removeRecording = useServerFn(deleteRecording);

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
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [facing, setFacing] = useState<FacingMode>("environment");
  const [viewerCount, setViewerCount] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [recordings, setRecordings] = useState<AdminRecording[]>([]);
  const [savingClip, setSavingClip] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const broadcastRef = useRef<ReturnType<typeof startAdminBroadcast> | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastPointRef = useRef<{ lat: number; lng: number } | null>(null);
  const roomRef = useRef<{ stop: () => void } | null>(null);
  const seenMsgRef = useRef<Set<string>>(new Set());
  const recorderRef = useRef<RecorderHandle | null>(null);
  const sessionStartRef = useRef<number | null>(null);
  const kmsRef = useRef(0);

  useEffect(() => { kmsRef.current = kms; }, [kms]);

  useEffect(() => {
    const s = loadSession();
    if (!s || s.role !== "admin") navigate({ to: "/" });
  }, [navigate]);

  const loadList = useCallback(async () => {
    if (!session) return;
    try {
      const rows = await fetchRecordings({ data: { password: session.password } });
      setRecordings(rows as AdminRecording[]);
    } catch (e) {
      console.error(e);
    }
  }, [session, fetchRecordings]);

  useEffect(() => { void loadList(); }, [loadList]);

  useEffect(() => {
    const room = joinAsAdmin({
      onViewerCount: setViewerCount,
      onMessage: (msg) => {
        if (seenMsgRef.current.has(msg.id)) return;
        seenMsgRef.current.add(msg.id);
        setMessages((m) => [...m.slice(-49), msg]);
        playChime();
      },
    });
    roomRef.current = room;
    return () => { room.stop(); roomRef.current = null; };
  }, []);

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
        video: { facingMode: facing, width: { ideal: 1280 } },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;

      broadcastRef.current = startAdminBroadcast(stream);
      recorderRef.current = startRecorder(stream);
      sessionStartRef.current = Date.now();
      await setState({ data: { password: session.password, isLive: true } });
      setLive(true);
      setStartedAt(Date.now());
      setTrail([]);
      setKms(0);
      setPlaceName(null);
      lastPointRef.current = null;

      if ("geolocation" in navigator) {
        watchIdRef.current = navigator.geolocation.watchPosition(
          async (pos) => {
            const { latitude, longitude, accuracy, speed } = pos.coords;
            setCoords({ lat: latitude, lng: longitude, acc: accuracy, speed: speed ?? null });
            setTrail((t) => {
              const next = [...t, [latitude, longitude] as [number, number]];
              return next.length > 2000 ? next.slice(-2000) : next;
            });
            let distanceKm = kmsRef.current;
            if (lastPointRef.current) {
              distanceKm += haversineKm(lastPointRef.current, { lat: latitude, lng: longitude });
              setKms(distanceKm);
            }
            lastPointRef.current = { lat: latitude, lng: longitude };
            const place = await reverseGeocode(latitude, longitude);
            if (place) setPlaceName(place);
            try {
              await push({
                data: {
                  password: session.password,
                  lat: latitude,
                  lng: longitude,
                  accuracy,
                  speed: speed ?? null,
                  distanceKm,
                  placeName: place ?? undefined,
                },
              });
            } catch { /* swallow */ }
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

    // Save the recording before tearing down tracks.
    const rec = recorderRef.current;
    recorderRef.current = null;
    const startTs = sessionStartRef.current;
    sessionStartRef.current = null;
    const distance = kmsRef.current;

    if (rec && session) {
      setSavingClip(true);
      try {
        const { blob, mimeType, durationMs } = await rec.stop();
        if (blob.size > 0) {
          const ext = mimeType.includes("mp4") ? "mp4" : "webm";
          const { path, token } = await signUpload({
            data: { password: session.password, ext },
          });
          const up = await supabase.storage
            .from("recordings")
            .uploadToSignedUrl(path, token, blob, { contentType: mimeType });
          if (up.error) throw up.error;
          const title = `Ride · ${new Date(startTs ?? Date.now()).toLocaleString()}`;
          await persistRecording({
            data: {
              password: session.password,
              title,
              storagePath: path,
              durationSeconds: Math.round(durationMs / 1000),
              distanceKm: Number(distance.toFixed(3)),
              sizeBytes: blob.size,
              mimeType,
              startedAt: startTs ? new Date(startTs).toISOString() : null,
              endedAt: new Date().toISOString(),
              isPublic: true,
            },
          });
          await loadList();
        }
      } catch (e) {
        setError(e instanceof Error ? `Recording: ${e.message}` : "Failed to save recording");
      } finally {
        setSavingClip(false);
      }
    }

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setLive(false);
    setStartedAt(null);
    if (session) {
      try { await setState({ data: { password: session.password, isLive: false } }); } catch { /* ignore */ }
    }
  }

  async function flipCamera() {
    const next: FacingMode = facing === "environment" ? "user" : "environment";
    setFacing(next);
    if (!live || !streamRef.current) return;
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: next, width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current.getVideoTracks().forEach((t) => t.stop());
      const newVideoTrack = newStream.getVideoTracks()[0];
      const audioTracks = streamRef.current.getAudioTracks();
      const composite = new MediaStream([newVideoTrack, ...audioTracks]);
      streamRef.current = composite;
      if (videoRef.current) videoRef.current.srcObject = composite;
      broadcastRef.current?.replaceVideoTrack(composite);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to switch camera");
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
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card/60 px-3 py-2 text-sm" title="Viewers watching live">
            <Eye className="h-4 w-4 text-primary" />
            <span className="font-mono">{viewerCount}</span>
            <span className="text-muted-foreground">watching</span>
          </span>
          <button onClick={() => setShowSettings((v) => !v)} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-secondary">
            <Settings2 className="inline h-4 w-4" /> Settings
          </button>
          <button onClick={logout} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-secondary">
            <LogOut className="inline h-4 w-4" /> Log out
          </button>
        </div>
      </header>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      <div className="mt-6 grid gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="relative aspect-video overflow-hidden rounded-2xl border border-border bg-black">
          <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
          {!live && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card/80 backdrop-blur">
              <CameraOff className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Camera off. Start broadcast to go live.</p>
            </div>
          )}
          {live && (
            <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-destructive px-3 py-1 text-xs font-semibold uppercase tracking-wider text-destructive-foreground pulse-live">
              <Radio className="h-3.5 w-3.5" /> LIVE · REC
            </div>
          )}
          {live && (placeName || kms > 0) && (
            <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-end justify-between gap-2">
              {placeName && (
                <div className="inline-flex max-w-[70%] items-center gap-1.5 rounded-lg bg-black/60 px-3 py-1.5 text-sm font-medium text-white backdrop-blur">
                  <MapPin className="h-4 w-4 text-primary" />
                  <span className="truncate">{placeName}</span>
                </div>
              )}
              <div className="inline-flex items-center gap-1.5 rounded-lg bg-black/60 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur">
                <Bike className="h-4 w-4 text-primary" />
                <span className="font-mono">{kms.toFixed(2)} km</span>
              </div>
            </div>
          )}
          <button
            onClick={flipCamera}
            className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-black/80"
            title="Switch between rear and front camera"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {facing === "environment" ? "Rear" : "Front (Selfie)"}
          </button>
        </div>

        <div className="aspect-video lg:aspect-auto">
          <LiveMap lat={coords?.lat ?? null} lng={coords?.lng ?? null} trail={trail} />
        </div>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-4">
        <Stat label="Distance" value={`${kms.toFixed(2)} km`} icon={<Bike className="h-4 w-4" />} />
        <Stat label="Speed" value={`${speedKmh.toFixed(1)} km/h`} icon={<Gauge className="h-4 w-4" />} />
        <Stat label="Elapsed" value={formatElapsed(elapsed)} icon={<Radio className="h-4 w-4" />} />
        <Stat label="Place" value={placeName ?? "—"} icon={<MapPin className="h-4 w-4" />} />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {!live ? (
          <button onClick={start} className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground glow-lime transition hover:brightness-110">
            <Video className="h-5 w-5" /> Start broadcast
          </button>
        ) : (
          <button onClick={stop} className="inline-flex items-center gap-2 rounded-xl bg-destructive px-6 py-3 font-semibold text-destructive-foreground transition hover:brightness-110">
            <Square className="h-5 w-5" /> Stop &amp; save broadcast
          </button>
        )}
        <p className="text-sm text-muted-foreground">
          Live feed is peer-to-peer. Each ride is also recorded and saved here when you stop.
        </p>
        {savingClip && (
          <span className="text-xs text-primary">Uploading recording…</span>
        )}
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Viewer messages */}
      <section className="mt-8 rounded-2xl border border-border bg-card/70 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="display flex items-center gap-2 text-xl">
            <MessageCircle className="h-5 w-5 text-primary" /> Viewer messages
          </h2>
          {messages.length > 0 && (
            <button onClick={() => setMessages([])} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
          )}
        </div>
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages yet. Viewers can chat from the live page.</p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {[...messages].reverse().map((m) => (
              <li key={m.id} className="rounded-lg border border-border bg-background/60 px-3 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-xs text-primary">viewer·{m.from}</span>
                  <span className="text-[10px] text-muted-foreground">{new Date(m.ts).toLocaleTimeString()}</span>
                </div>
                <p className="mt-1 break-words text-sm">{m.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Saved recordings */}
      <section className="mt-8 rounded-2xl border border-border bg-card/70 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="display flex items-center gap-2 text-xl">
            <Video className="h-5 w-5 text-primary" /> Saved rides
          </h2>
          <button onClick={() => void loadList()} className="text-xs text-muted-foreground hover:text-foreground">
            Refresh
          </button>
        </div>
        {recordings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved rides yet. Stop a broadcast to save one here.</p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {recordings.map((r) => (
              <RecordingCard
                key={r.id}
                rec={r}
                onUpdate={async (patch) => {
                  if (!session) return;
                  await patchRecording({ data: { password: session.password, id: r.id, ...patch } });
                  await loadList();
                }}
                onDelete={async () => {
                  if (!session) return;
                  await removeRecording({ data: { password: session.password, id: r.id } });
                  await loadList();
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function RecordingCard({
  rec,
  onUpdate,
  onDelete,
}: {
  rec: AdminRecording;
  onUpdate: (patch: { title?: string; isPublic?: boolean }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(rec.title);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);

  async function saveTitle() {
    if (!title.trim() || title === rec.title) { setEditing(false); return; }
    setBusy(true);
    try { await onUpdate({ title: title.trim() }); setEditing(false); } finally { setBusy(false); }
  }

  return (
    <li className="overflow-hidden rounded-xl border border-border bg-background/60">
      <video src={rec.url} controls preload="metadata" className="aspect-video w-full bg-black" />
      <div className="p-3">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
              autoFocus
            />
            <button disabled={busy} onClick={() => void saveTitle()} className="rounded-md bg-primary px-2 py-1 text-primary-foreground" title="Save"><Check className="h-4 w-4" /></button>
            <button onClick={() => { setEditing(false); setTitle(rec.title); }} className="rounded-md border border-border px-2 py-1" title="Cancel"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-semibold">{rec.title}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {new Date(rec.created_at).toLocaleString()} · {formatDuration(rec.duration_seconds)} · {rec.distance_km.toFixed(2)} km · {formatBytes(rec.size_bytes)}
              </div>
            </div>
            <button onClick={() => setEditing(true)} className="rounded-md border border-border p-1.5 hover:bg-secondary" title="Edit title">
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            onClick={() => void onUpdate({ isPublic: !rec.is_public })}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${
              rec.is_public
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border text-muted-foreground"
            }`}
            title="Toggle visibility to viewers"
          >
            {rec.is_public ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {rec.is_public ? "Visible to viewers" : "Hidden from viewers"}
          </button>

          {confirmDel ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Delete?</span>
              <button
                disabled={busy}
                onClick={async () => { setBusy(true); try { await onDelete(); } finally { setBusy(false); } }}
                className="rounded-md bg-destructive px-2 py-1 text-xs text-destructive-foreground"
              >
                Yes, delete
              </button>
              <button onClick={() => setConfirmDel(false)} className="rounded-md border border-border px-2 py-1 text-xs">Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDel(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card/70 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        {icon} {label}
      </div>
      <div className="display mt-2 truncate text-3xl" title={value}>{value}</div>
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
    setBusy(true); setMsg(null);
    try {
      await change({ data: { currentAdmin, newAdmin: newAdmin || undefined, newUser: newUser || undefined } });
      if (newAdmin && session) saveSession({ role: "admin", password: newAdmin });
      setMsg("Saved.");
      setCurrentAdmin(""); setNewAdmin(""); setNewUser("");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="mt-5 rounded-2xl border border-border bg-card/80 p-5 backdrop-blur">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="display text-xl">Change passwords</h2>
        <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">Close</button>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Current admin pass" value={currentAdmin} onChange={setCurrentAdmin} required />
        <Field label="New admin pass (optional)" value={newAdmin} onChange={setNewAdmin} />
        <Field label="New viewer pass (optional)" value={newUser} onChange={setNewUser} />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button disabled={busy || !currentAdmin || (!newAdmin && !newUser)} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
        {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
      </div>
    </form>
  );
}

function Field({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
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
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

function formatDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

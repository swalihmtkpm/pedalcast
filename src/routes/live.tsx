import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadSession, saveSession } from "@/lib/usePedalSession";
import { startViewer } from "@/lib/webrtcSignaling";
import { joinAsViewer } from "@/lib/pedalRoom";
import { LiveMap } from "@/components/LiveMap";
import { Bike, LogOut, MapPin, Radio, Send, Video } from "lucide-react";

export const Route = createFileRoute("/live")({
  component: ViewerPage,
  head: () => ({ meta: [{ title: "Pedalcast · Live View" }] }),
});

type LiveRow = {
  is_live: boolean;
  lat: number | null;
  lng: number | null;
  speed: number | null;
  started_at: string | null;
  distance_km: number | null;
  place_name: string | null;
};

type PublicRecording = {
  id: string;
  title: string;
  storage_path: string;
  duration_seconds: number;
  distance_km: number;
  created_at: string;
};

function ViewerPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewerRef = useRef<{ stop: () => void; requestRejoin: () => void } | null>(null);
  const roomRef = useRef<ReturnType<typeof joinAsViewer> | null>(null);
  const [hasStream, setHasStream] = useState(false);
  const [trail, setTrail] = useState<Array<[number, number]>>([]);
  const [row, setRow] = useState<LiveRow | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [sentLog, setSentLog] = useState<Array<{ id: string; text: string; ts: number }>>([]);
  const [sending, setSending] = useState(false);

  const [recordings, setRecordings] = useState<PublicRecording[]>([]);
  const bucketBase = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/recordings/`;

  useEffect(() => {
    const room = joinAsViewer();
    roomRef.current = room;
    return () => {
      room.stop();
      roomRef.current = null;
    };
  }, []);

  // Load public recordings
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await supabase
        .from("recordings")
        .select("id,title,storage_path,duration_seconds,distance_km,created_at")
        .eq("is_public", true)
        .order("created_at", { ascending: false })
        .limit(30);
      if (alive && data) setRecordings(data as PublicRecording[]);
    };
    void load();
    const ch = supabase
      .channel("recordings_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "recordings" }, () => void load())
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, []);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || !roomRef.current) return;
    setSending(true);
    try {
      await roomRef.current.sendChat(text);
      setSentLog((s) => [
        ...s.slice(-19),
        { id: crypto.randomUUID(), text, ts: Date.now() },
      ]);
      setChatInput("");
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    const s = loadSession();
    if (!s) navigate({ to: "/" });
  }, [navigate]);

  // Fetch initial + subscribe
  useEffect(() => {
    let mounted = true;
    supabase
      .from("live_session")
      .select("is_live,lat,lng,speed,started_at,distance_km,place_name")
      .eq("id", 1)
      .single()
      .then(({ data }) => {
        if (mounted && data) setRow(data as LiveRow);
      });

    const ch = supabase
      .channel("live_session_changes")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "live_session" },
        (payload) => {
          const r = payload.new as LiveRow;
          setRow(r);
          if (r.lat != null && r.lng != null) {
            setTrail((t) => {
              const next = [...t, [r.lat!, r.lng!] as [number, number]];
              return next.length > 2000 ? next.slice(-2000) : next;
            });
          }
          if (!r.is_live) setTrail([]);
        },
      )
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, []);

  // WebRTC viewer lifecycle tied to is_live
  useEffect(() => {
    if (!row?.is_live) {
      viewerRef.current?.stop();
      viewerRef.current = null;
      setHasStream(false);
      if (videoRef.current) videoRef.current.srcObject = null;
      return;
    }
    if (viewerRef.current) return;
    viewerRef.current = startViewer((stream) => {
      if (videoRef.current) videoRef.current.srcObject = stream;
      setHasStream(!!stream);
    });
    return () => {
      viewerRef.current?.stop();
      viewerRef.current = null;
    };
  }, [row?.is_live]);

  function logout() {
    viewerRef.current?.stop();
    saveSession(null);
    navigate({ to: "/" });
  }

  const speedKmh = row?.speed != null ? Math.max(0, row.speed * 3.6).toFixed(1) : "—";

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 md:px-6">
      <header className="flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Bike className="h-5 w-5" />
          </span>
          <span className="display text-xl">PEDALCAST · LIVE</span>
        </Link>
        <button
          onClick={logout}
          className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-secondary"
        >
          <LogOut className="inline h-4 w-4" /> Log out
        </button>
      </header>

      <div className="mt-6 grid gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="relative aspect-video overflow-hidden rounded-2xl border border-border bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            controls
            className="h-full w-full object-cover"
          />
          {!row?.is_live && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card/85 backdrop-blur">
              <div className="display text-3xl text-muted-foreground">OFF AIR</div>
              <p className="max-w-sm text-center text-sm text-muted-foreground">
                The rider isn't broadcasting right now. This page will go live
                automatically the moment they start.
              </p>
            </div>
          )}
          {row?.is_live && !hasStream && (
            <div className="absolute inset-0 flex items-center justify-center bg-card/70 backdrop-blur">
              <p className="text-sm text-muted-foreground">Connecting to live feed…</p>
            </div>
          )}
          {row?.is_live && (
            <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-destructive px-3 py-1 text-xs font-semibold uppercase tracking-wider text-destructive-foreground pulse-live">
              <Radio className="h-3.5 w-3.5" /> LIVE
            </div>
          )}
        </div>

        <div className="aspect-video lg:aspect-auto">
          <LiveMap lat={row?.lat ?? null} lng={row?.lng ?? null} trail={trail} />
        </div>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-3">
        <Stat label="Status" value={row?.is_live ? "On air" : "Off air"} />
        <Stat label="Speed" value={`${speedKmh} km/h`} />
        <Stat
          label="Position"
          value={
            row?.lat != null && row.lng != null
              ? `${row.lat.toFixed(4)}, ${row.lng.toFixed(4)}`
              : "—"
          }
        />
      </div>

      {/* Chat with the rider */}
      <section className="mt-8 rounded-2xl border border-border bg-card/70 p-5">
        <h2 className="display text-xl">Send a message to the rider</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Messages chime on the rider's device the moment they arrive.
        </p>
        <form onSubmit={sendMessage} className="mt-4 flex gap-2">
          <input
            type="text"
            value={chatInput}
            maxLength={500}
            placeholder="Cheer them on…"
            onChange={(e) => setChatInput(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={sending || !chatInput.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            <Send className="h-4 w-4" /> Send
          </button>
        </form>
        {sentLog.length > 0 && (
          <ul className="mt-4 space-y-2">
            {[...sentLog].reverse().map((m) => (
              <li
                key={m.id}
                className="rounded-lg border border-border bg-background/60 px-3 py-2 text-sm"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs text-muted-foreground">You</span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(m.ts).toLocaleTimeString()}
                  </span>
                </div>
                <p className="mt-1 break-words">{m.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/70 p-4">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="display mt-2 text-2xl">{value}</div>
    </div>
  );
}

import { supabase } from "@/integrations/supabase/client";

const ROOM = "pedalcast-room";

export type ChatMessage = {
  id: string;
  text: string;
  ts: number;
  from: string; // short viewer id
};

// VIEWER: join presence so the admin can count, and send chat messages.
export function joinAsViewer(opts: {
  onAdminPresent?: (present: boolean) => void;
} = {}) {
  const viewerId = crypto.randomUUID().slice(0, 8);
  const channel = supabase.channel(ROOM, {
    config: { presence: { key: viewerId } },
  });

  channel
    .on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as Record<string, Array<{ role?: string }>>;
      const adminHere = Object.values(state).some((arr) =>
        arr.some((m) => m.role === "admin"),
      );
      opts.onAdminPresent?.(adminHere);
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ role: "viewer", joined_at: Date.now() });
      }
    });

  return {
    viewerId,
    sendChat(text: string) {
      const msg: ChatMessage = {
        id: crypto.randomUUID(),
        text: text.slice(0, 500),
        ts: Date.now(),
        from: viewerId,
      };
      return channel.send({ type: "broadcast", event: "chat", payload: msg });
    },
    stop() {
      supabase.removeChannel(channel);
    },
  };
}

// ADMIN: track viewer count + receive chat messages.
export function joinAsAdmin(opts: {
  onViewerCount: (n: number) => void;
  onMessage: (msg: ChatMessage) => void;
}) {
  const channel = supabase.channel(ROOM, {
    config: { presence: { key: "admin" } },
  });

  channel
    .on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as Record<string, unknown[]>;
      const count = Object.entries(state)
        .filter(([key]) => key !== "admin")
        .reduce((acc, [, arr]) => acc + arr.length, 0);
      opts.onViewerCount(count);
    })
    .on("broadcast", { event: "chat" }, ({ payload }) => {
      opts.onMessage(payload as ChatMessage);
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ role: "admin", joined_at: Date.now() });
      }
    });

  return {
    stop() {
      supabase.removeChannel(channel);
    },
  };
}

// Short pleasant chime via WebAudio — no asset needed.
export function playChime() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.12;
      const end = start + 0.18;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* ignore */
  }
}

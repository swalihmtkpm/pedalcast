import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const CHANNEL = "pedalcast-stream";

type SignalMsg =
  | { kind: "viewer-join"; viewerId: string }
  | { kind: "offer"; viewerId: string; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; viewerId: string; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; viewerId: string; from: "admin" | "viewer"; candidate: RTCIceCandidateInit }
  | { kind: "admin-leave" };

function getChannel(): RealtimeChannel {
  return supabase.channel(CHANNEL, { config: { broadcast: { self: false } } });
}

// ADMIN: publishes a MediaStream to any viewer who joins.
export function startAdminBroadcast(stream: MediaStream) {
  const channel = getChannel();
  const peers = new Map<string, RTCPeerConnection>();

  const send = (payload: SignalMsg) =>
    channel.send({ type: "broadcast", event: "sig", payload });

  async function handleViewerJoin(viewerId: string) {
    // Close existing if reconnecting
    peers.get(viewerId)?.close();
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peers.set(viewerId, pc);

    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        send({ kind: "ice", viewerId, from: "admin", candidate: e.candidate.toJSON() });
      }
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        peers.delete(viewerId);
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ kind: "offer", viewerId, sdp: offer });
  }

  channel
    .on("broadcast", { event: "sig" }, async ({ payload }: { payload: SignalMsg }) => {
      if (payload.kind === "viewer-join") {
        handleViewerJoin(payload.viewerId);
      } else if (payload.kind === "answer") {
        const pc = peers.get(payload.viewerId);
        if (pc) await pc.setRemoteDescription(payload.sdp);
      } else if (payload.kind === "ice" && payload.from === "viewer") {
        const pc = peers.get(payload.viewerId);
        if (pc) {
          try { await pc.addIceCandidate(payload.candidate); } catch { /* ignore */ }
        }
      }
    })
    .subscribe();

  return {
    stop() {
      send({ kind: "admin-leave" });
      peers.forEach((p) => p.close());
      peers.clear();
      supabase.removeChannel(channel);
    },
  };
}

// VIEWER: subscribes and receives a MediaStream.
export function startViewer(onStream: (stream: MediaStream | null) => void) {
  const channel = getChannel();
  const viewerId = crypto.randomUUID();
  let pc: RTCPeerConnection | null = null;
  const remoteStream = new MediaStream();

  const send = (payload: SignalMsg) =>
    channel.send({ type: "broadcast", event: "sig", payload });

  function setupPc() {
    pc?.close();
    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.ontrack = (e) => {
      e.streams[0]?.getTracks().forEach((t) => {
        if (!remoteStream.getTracks().includes(t)) remoteStream.addTrack(t);
      });
      onStream(remoteStream);
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        send({ kind: "ice", viewerId, from: "viewer", candidate: e.candidate.toJSON() });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc && ["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        onStream(null);
      }
    };
  }

  channel
    .on("broadcast", { event: "sig" }, async ({ payload }: { payload: SignalMsg }) => {
      if (payload.kind === "offer" && payload.viewerId === viewerId) {
        setupPc();
        await pc!.setRemoteDescription(payload.sdp);
        const ans = await pc!.createAnswer();
        await pc!.setLocalDescription(ans);
        send({ kind: "answer", viewerId, sdp: ans });
      } else if (payload.kind === "ice" && payload.from === "admin" && payload.viewerId === viewerId) {
        if (pc) {
          try { await pc.addIceCandidate(payload.candidate); } catch { /* ignore */ }
        }
      } else if (payload.kind === "admin-leave") {
        pc?.close();
        pc = null;
        onStream(null);
      }
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        send({ kind: "viewer-join", viewerId });
      }
    });

  return {
    stop() {
      pc?.close();
      supabase.removeChannel(channel);
    },
    requestRejoin() {
      send({ kind: "viewer-join", viewerId });
    },
  };
}

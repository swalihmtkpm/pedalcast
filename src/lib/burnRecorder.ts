// Records a canvas-composited video that burns the live overlay
// (place name + distance) into every frame, plus the source audio.

export type OverlaySnapshot = {
  placeName: string | null;
  distanceKm: number;
  speedKmh: number;
  timestampMs: number;
};

export type BurnRecorderHandle = {
  updateStream: (stream: MediaStream) => void;
  stop: () => Promise<{ blob: Blob; mimeType: string; durationMs: number }>;
};

const WIDTH = 1280;
const HEIGHT = 720;

export function startBurnRecorder(
  initialStream: MediaStream,
  getOverlay: () => OverlaySnapshot,
): BurnRecorderHandle | null {
  if (typeof MediaRecorder === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Hidden <video> element to pull frames from the live MediaStream.
  const sourceVideo = document.createElement("video");
  sourceVideo.muted = true;
  sourceVideo.playsInline = true;
  sourceVideo.autoplay = true;
  sourceVideo.srcObject = initialStream;
  void sourceVideo.play().catch(() => {});

  let currentStream = initialStream;

  // Composite output: canvas video + original audio tracks.
  const canvasStream = canvas.captureStream(30);
  const audioTracks = initialStream.getAudioTracks();
  audioTracks.forEach((t) => canvasStream.addTrack(t));

  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  const mimeType =
    candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
  let rec: MediaRecorder;
  try {
    rec = mimeType
      ? new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: 2_500_000 })
      : new MediaRecorder(canvasStream);
  } catch {
    return null;
  }

  const chunks: BlobPart[] = [];
  const startedAt = Date.now();
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  rec.start(2000);

  let rafId = 0;
  let stopped = false;

  function drawFrame() {
    if (stopped) return;
    try {
      ctx!.fillStyle = "#000";
      ctx!.fillRect(0, 0, WIDTH, HEIGHT);

      const vw = sourceVideo.videoWidth;
      const vh = sourceVideo.videoHeight;
      if (vw > 0 && vh > 0) {
        // cover-fit
        const scale = Math.max(WIDTH / vw, HEIGHT / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        const dx = (WIDTH - dw) / 2;
        const dy = (HEIGHT - dh) / 2;
        ctx!.drawImage(sourceVideo, dx, dy, dw, dh);
      }

      const o = getOverlay();
      drawOverlay(ctx!, o);
    } catch {
      /* ignore frame errors */
    }
    rafId = requestAnimationFrame(drawFrame);
  }
  rafId = requestAnimationFrame(drawFrame);

  return {
    updateStream(stream: MediaStream) {
      currentStream = stream;
      sourceVideo.srcObject = stream;
      void sourceVideo.play().catch(() => {});
      // Refresh audio routing
      canvasStream.getAudioTracks().forEach((t) => {
        canvasStream.removeTrack(t);
      });
      stream.getAudioTracks().forEach((t) => canvasStream.addTrack(t));
    },
    stop() {
      return new Promise((resolve) => {
        rec.onstop = () => {
          stopped = true;
          cancelAnimationFrame(rafId);
          try { sourceVideo.srcObject = null; } catch { /* noop */ }
          const type = rec.mimeType || mimeType || "video/webm";
          void currentStream;
          resolve({
            blob: new Blob(chunks, { type }),
            mimeType: type,
            durationMs: Date.now() - startedAt,
          });
        };
        if (rec.state !== "inactive") rec.stop();
        else rec.onstop?.(new Event("stop"));
      });
    },
  };
}

function drawOverlay(ctx: CanvasRenderingContext2D, o: OverlaySnapshot) {
  ctx.save();
  ctx.font =
    "600 26px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto";
  ctx.textBaseline = "middle";

  // LIVE · REC badge (top-left)
  drawPill(ctx, 24, 24, "● LIVE · REC", "#ef4444", "#fff");

  // Time (top-right)
  const time = new Date(o.timestampMs).toLocaleTimeString();
  const tw = ctx.measureText(time).width + 36;
  drawPill(ctx, ctx.canvas.width - 24 - tw, 24, time, "rgba(0,0,0,0.6)", "#fff");

  // Place (bottom-left)
  if (o.placeName) {
    const label = `📍 ${o.placeName}`;
    const w = Math.min(
      ctx.measureText(label).width + 36,
      ctx.canvas.width - 320,
    );
    drawPill(
      ctx,
      24,
      ctx.canvas.height - 24 - 44,
      label,
      "rgba(0,0,0,0.65)",
      "#fff",
      w,
    );
  }

  // Distance + speed (bottom-right)
  const stat = `${o.distanceKm.toFixed(2)} km · ${o.speedKmh.toFixed(1)} km/h`;
  const sw = ctx.measureText(stat).width + 36;
  drawPill(
    ctx,
    ctx.canvas.width - 24 - sw,
    ctx.canvas.height - 24 - 44,
    stat,
    "rgba(0,0,0,0.65)",
    "#bef264",
  );

  ctx.restore();
}

function drawPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  bg: string,
  fg: string,
  forcedWidth?: number,
) {
  const padX = 18;
  const h = 44;
  const w = forcedWidth ?? ctx.measureText(text).width + padX * 2;
  const r = 12;
  ctx.fillStyle = bg;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.fillStyle = fg;
  // Clip text if forced width is smaller than natural
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + padX, y, w - padX * 2, h);
  ctx.clip();
  ctx.fillText(text, x + padX, y + h / 2);
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

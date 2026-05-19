// MediaRecorder wrapper that captures the full broadcast as a single Blob.

export type RecorderHandle = {
  stop: () => Promise<{ blob: Blob; mimeType: string; durationMs: number }>;
};

export function startRecorder(stream: MediaStream): RecorderHandle | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  const mimeType = candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
  let rec: MediaRecorder;
  try {
    rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  } catch {
    return null;
  }
  const chunks: BlobPart[] = [];
  const startedAt = Date.now();
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  rec.start(2000); // flush every 2s so long rides don't OOM

  return {
    stop() {
      return new Promise((resolve) => {
        rec.onstop = () => {
          const type = rec.mimeType || mimeType || "video/webm";
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

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Role = "admin" | "user";

async function getSettings() {
  const { data, error } = await supabaseAdmin
    .from("app_settings")
    .select("admin_password,user_password")
    .eq("id", 1)
    .single();
  if (error || !data) throw new Error("Settings unavailable");
  return data;
}

export const verifyPassword = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ password: z.string().min(1).max(200) }).parse(i))
  .handler(async ({ data }): Promise<{ role: Role }> => {
    const s = await getSettings();
    if (data.password === s.admin_password) return { role: "admin" };
    if (data.password === s.user_password) return { role: "user" };
    throw new Error("Invalid password");
  });

export const changePasswords = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z
      .object({
        currentAdmin: z.string().min(1),
        newAdmin: z.string().min(4).max(200).optional(),
        newUser: z.string().min(4).max(200).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    const s = await getSettings();
    if (data.currentAdmin !== s.admin_password) throw new Error("Wrong admin password");
    const patch: Record<string, string> = {};
    if (data.newAdmin) patch.admin_password = data.newAdmin;
    if (data.newUser) patch.user_password = data.newUser;
    if (Object.keys(patch).length === 0) throw new Error("Nothing to change");
    const { error } = await supabaseAdmin
      .from("app_settings")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setBroadcastState = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z
      .object({
        password: z.string().min(1),
        isLive: z.boolean(),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    const s = await getSettings();
    if (data.password !== s.admin_password) throw new Error("Unauthorized");
    const patch = {
      is_live: data.isLive,
      updated_at: new Date().toISOString(),
      ...(data.isLive
        ? { started_at: new Date().toISOString() }
        : { lat: null, lng: null, speed: null }),
    };
    const { error } = await supabaseAdmin.from("live_session").update(patch).eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const pushLocation = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z
      .object({
        password: z.string().min(1),
        lat: z.number(),
        lng: z.number(),
        accuracy: z.number().optional(),
        speed: z.number().nullable().optional(),
        distanceKm: z.number().min(0).max(100000).optional(),
        placeName: z.string().max(300).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    const s = await getSettings();
    if (data.password !== s.admin_password) throw new Error("Unauthorized");
    const patch: Record<string, unknown> = {
      lat: data.lat,
      lng: data.lng,
      accuracy: data.accuracy ?? null,
      speed: data.speed ?? null,
      updated_at: new Date().toISOString(),
    };
    if (data.distanceKm != null) patch.distance_km = data.distanceKm;
    if (data.placeName != null) patch.place_name = data.placeName;
    const { error } = await supabaseAdmin
      .from("live_session")
      .update(patch)
      .eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- Recordings --------

export const createRecordingUploadUrl = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z.object({ password: z.string().min(1), ext: z.enum(["webm", "mp4"]) }).parse(i),
  )
  .handler(async ({ data }) => {
    const s = await getSettings();
    if (data.password !== s.admin_password) throw new Error("Unauthorized");
    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${data.ext}`;
    const { data: signed, error } = await supabaseAdmin.storage
      .from("recordings")
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Cannot sign upload");
    return { path, token: signed.token };
  });

export const saveRecording = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z
      .object({
        password: z.string().min(1),
        title: z.string().min(1).max(200),
        storagePath: z.string().min(1).max(500),
        durationSeconds: z.number().int().min(0).max(86400),
        distanceKm: z.number().min(0).max(100000),
        sizeBytes: z.number().int().min(0).max(20 * 1024 * 1024 * 1024),
        mimeType: z.string().min(1).max(100),
        startedAt: z.string().datetime().nullable().optional(),
        endedAt: z.string().datetime().nullable().optional(),
        isPublic: z.boolean(),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    const s = await getSettings();
    if (data.password !== s.admin_password) throw new Error("Unauthorized");
    const { data: row, error } = await supabaseAdmin
      .from("recordings")
      .insert({
        title: data.title,
        storage_path: data.storagePath,
        duration_seconds: data.durationSeconds,
        distance_km: data.distanceKm,
        size_bytes: data.sizeBytes,
        mime_type: data.mimeType,
        started_at: data.startedAt ?? null,
        ended_at: data.endedAt ?? null,
        is_public: data.isPublic,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row!.id };
  });

export const listRecordingsAdmin = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ password: z.string().min(1) }).parse(i))
  .handler(async ({ data }) => {
    const s = await getSettings();
    if (data.password !== s.admin_password) throw new Error("Unauthorized");
    const { data: rows, error } = await supabaseAdmin
      .from("recordings")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const { data: pub } = supabaseAdmin.storage.from("recordings").getPublicUrl("");
    const base = pub.publicUrl;
    return (rows ?? []).map((r) => ({ ...r, url: `${base}${r.storage_path}` }));
  });

export const updateRecording = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z
      .object({
        password: z.string().min(1),
        id: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        isPublic: z.boolean().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    const s = await getSettings();
    if (data.password !== s.admin_password) throw new Error("Unauthorized");
    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.isPublic !== undefined) patch.is_public = data.isPublic;
    if (Object.keys(patch).length === 0) throw new Error("Nothing to update");
    const { error } = await supabaseAdmin.from("recordings").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteRecording = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z.object({ password: z.string().min(1), id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data }) => {
    const s = await getSettings();
    if (data.password !== s.admin_password) throw new Error("Unauthorized");
    const { data: row } = await supabaseAdmin
      .from("recordings")
      .select("storage_path")
      .eq("id", data.id)
      .single();
    if (row?.storage_path) {
      await supabaseAdmin.storage.from("recordings").remove([row.storage_path]);
    }
    const { error } = await supabaseAdmin.from("recordings").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

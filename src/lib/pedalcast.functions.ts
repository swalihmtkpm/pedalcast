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
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    const s = await getSettings();
    if (data.password !== s.admin_password) throw new Error("Unauthorized");
    const { error } = await supabaseAdmin
      .from("live_session")
      .update({
        lat: data.lat,
        lng: data.lng,
        accuracy: data.accuracy ?? null,
        speed: data.speed ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

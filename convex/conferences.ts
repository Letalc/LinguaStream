import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { requireAdmin } from "./lib/auth";

export function requireConferenceAdmin(key: string) {
  if (requireAdmin(key) !== "admin") {
    throw new ConvexError("Solo el administrador puede gestionar eventos");
  }
}

export async function requireActiveConference(ctx: MutationCtx, conferenceId: Id<"conferences">) {
  const conference = await ctx.db.get("conferences", conferenceId);
  if (!conference) throw new ConvexError("El evento no existe");
  if (conference.status !== "active") throw new ConvexError("El evento está archivado");
  return conference;
}

function cleanFields(name: string, description?: string) {
  const clean = name.trim();
  if (!clean || clean.length > 120) throw new ConvexError("El nombre debe tener entre 1 y 120 caracteres");
  if ((description?.trim().length ?? 0) > 1000) throw new ConvexError("La descripción admite hasta 1000 caracteres");
  return { name: clean, description: description?.trim() || undefined };
}

// Public catalogue; archived conferences remain available to admins and direct room links.
export const list = query({
  args: {},
  returns: v.array(schema.doc("conferences")),
  handler: async (ctx) => ctx.db.query("conferences").withIndex("by_status", (q) => q.eq("status", "active")).order("desc").take(100),
});

export const listForAdmin = query({
  args: { key: v.string() },
  returns: v.array(schema.doc("conferences")),
  handler: async (ctx, { key }) => {
    requireAdmin(key);
    const active = await ctx.db.query("conferences").withIndex("by_status", (q) => q.eq("status", "active")).order("desc").take(100);
    const archived = await ctx.db.query("conferences").withIndex("by_status", (q) => q.eq("status", "archived")).order("desc").take(100);
    return [...active, ...archived];
  },
});

export const create = mutation({
  args: { key: v.string(), name: v.string(), description: v.optional(v.string()) },
  returns: v.id("conferences"),
  handler: async (ctx, { key, name, description }) => {
    requireConferenceAdmin(key);
    return ctx.db.insert("conferences", { ...cleanFields(name, description), status: "active" });
  },
});

export const update = mutation({
  args: { key: v.string(), conferenceId: v.id("conferences"), name: v.string(), description: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { key, conferenceId, name, description }) => {
    requireConferenceAdmin(key);
    if (!(await ctx.db.get("conferences", conferenceId))) throw new ConvexError("El evento no existe");
    await ctx.db.patch("conferences", conferenceId, cleanFields(name, description));
    return null;
  },
});

export const setArchived = mutation({
  args: { key: v.string(), conferenceId: v.id("conferences"), archived: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { key, conferenceId, archived }) => {
    requireConferenceAdmin(key);
    if (!(await ctx.db.get("conferences", conferenceId))) throw new ConvexError("El evento no existe");
    if (archived) {
      for (const status of ["live", "reconnecting", "paused"] as const) {
        const running = await ctx.db.query("sessions").withIndex("by_conferenceId_and_status", (q) => q.eq("conferenceId", conferenceId).eq("status", status)).first();
        if (running) throw new ConvexError("Finalizá las transmisiones del evento antes de archivarlo");
      }
    }
    await ctx.db.patch("conferences", conferenceId, { status: archived ? "archived" : "active" });
    return null;
  },
});

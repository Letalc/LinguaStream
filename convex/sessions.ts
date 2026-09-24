import { ConvexError, v } from "convex/values";
import { internalQuery, mutation, query, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { langValidator, statusValidator } from "./schema";
import { requireAdmin } from "./lib/auth";

// ---------- Public reads (audience, overlay, dashboard) ----------

export const list = query({
  args: {},
  handler: async (ctx) => {
    // A conference has tens of sessions, not thousands: a bounded take is enough.
    const sessions = await ctx.db.query("sessions").order("desc").take(200);
    return sessions.filter((s) => s.status !== "ended").concat(
      sessions.filter((s) => s.status === "ended"),
    );
  },
});

export const get = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    return await ctx.db.get("sessions", sessionId);
  },
});

// Dashboard: sessions joined with their operational stats.
export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    const sessions = await ctx.db.query("sessions").order("desc").take(200);
    return await Promise.all(
      sessions.map(async (s) => {
        const stats = await ctx.db
          .query("sessionStats")
          .withIndex("by_sessionId", (q) => q.eq("sessionId", s._id))
          .unique();
        return {
          ...s,
          stats: stats && {
            lastHeartbeatAt: stats.lastHeartbeatAt,
            segmentCount: stats.segmentCount,
            avgLatencyMs:
              stats.latencyCount > 0 ? Math.round(stats.latencySumMs / stats.latencyCount) : null,
            errorCount: stats.errorCount,
            reconnectCount: stats.reconnectCount,
            lastError: stats.lastError ?? null,
            lastErrorAt: stats.lastErrorAt ?? null,
          },
        };
      }),
    );
  },
});

// ---------- Production (admin) ----------

export const create = mutation({
  args: {
    key: v.string(),
    title: v.string(),
    room: v.string(),
    speaker: v.optional(v.string()),
    sourceLang: langValidator,
    targetLangs: v.array(langValidator),
  },
  handler: async (ctx, { key, ...fields }) => {
    requireAdmin(key);
    const targetLangs = [...new Set(fields.targetLangs)].filter((l) => l !== fields.sourceLang);
    const sessionId = await ctx.db.insert("sessions", {
      ...fields,
      targetLangs,
      status: "idle",
      nextSeq: 0,
    });
    await ctx.db.insert("sessionStats", {
      sessionId,
      lastHeartbeatAt: 0,
      segmentCount: 0,
      latencySumMs: 0,
      latencyCount: 0,
      errorCount: 0,
      reconnectCount: 0,
    });
    return sessionId;
  },
});

export const remove = mutation({
  args: { key: v.string(), sessionId: v.id("sessions") },
  handler: async (ctx, { key, sessionId }) => {
    requireAdmin(key);
    // Delete a bounded batch of children; enough for a demo-sized talk.
    for (const seg of await ctx.db
      .query("segments")
      .withIndex("by_sessionId_and_seq", (q) => q.eq("sessionId", sessionId))
      .take(4000)) {
      await ctx.db.delete("segments", seg._id);
    }
    for (const table of ["partials", "sessionStats"] as const) {
      const rows =
        table === "partials"
          ? await ctx.db
              .query("partials")
              .withIndex("by_sessionId_and_lang", (q) => q.eq("sessionId", sessionId))
              .take(10)
          : await ctx.db
              .query("sessionStats")
              .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
              .take(10);
      for (const r of rows) await ctx.db.delete(table, r._id);
    }
    await ctx.db.delete("sessions", sessionId);
    return null;
  },
});

// ---------- Room console ----------

// The console claims the session. Only one console may own a session at a time;
// `force` lets an operator take over (e.g. the previous laptop crashed).
export const claim = mutation({
  args: {
    key: v.string(),
    sessionId: v.id("sessions"),
    consoleId: v.string(),
    force: v.boolean(),
  },
  handler: async (ctx, { key, sessionId, consoleId, force }) => {
    requireAdmin(key);
    const session = await mustGet(ctx, sessionId);
    const stats = await getStats(ctx, sessionId);
    const ownerAlive =
      session.consoleId !== undefined &&
      session.consoleId !== consoleId &&
      stats !== null &&
      Date.now() - stats.lastHeartbeatAt < 15_000;
    if (ownerAlive && !force) {
      return { ok: false as const, reason: "Another console is already live for this session" };
    }
    await ctx.db.patch("sessions", sessionId, { consoleId });
    return { ok: true as const };
  },
});

export const setStatus = mutation({
  args: {
    key: v.string(),
    sessionId: v.id("sessions"),
    consoleId: v.string(),
    status: statusValidator,
    error: v.optional(v.string()),
  },
  handler: async (ctx, { key, sessionId, consoleId, status, error }) => {
    requireAdmin(key);
    const session = await mustOwn(ctx, sessionId, consoleId);
    const patch: Partial<typeof session> = { status };
    if (status === "live" && session.startedAt === undefined) patch.startedAt = Date.now();
    if (status === "ended") patch.endedAt = Date.now();
    await ctx.db.patch("sessions", sessionId, patch);

    const stats = await getStats(ctx, sessionId);
    if (stats) {
      await ctx.db.patch("sessionStats", stats._id, {
        lastHeartbeatAt: Date.now(),
        ...(status === "reconnecting" ? { reconnectCount: stats.reconnectCount + 1 } : {}),
        // Reconnects are logged but only real failures count as errors.
        ...(error ? { lastError: error.slice(0, 500), lastErrorAt: Date.now() } : {}),
        ...(status === "error" ? { errorCount: stats.errorCount + 1 } : {}),
      });
    }
    // Clear in-progress lines when the talk ends.
    if (status === "ended") {
      const partials = await ctx.db
        .query("partials")
        .withIndex("by_sessionId_and_lang", (q) => q.eq("sessionId", sessionId))
        .take(10);
      for (const p of partials) await ctx.db.delete("partials", p._id);
    }
    return session.startedAt ?? patch.startedAt ?? null;
  },
});

export const heartbeat = mutation({
  args: { key: v.string(), sessionId: v.id("sessions"), consoleId: v.string() },
  handler: async (ctx, { key, sessionId, consoleId }) => {
    requireAdmin(key);
    await mustOwn(ctx, sessionId, consoleId);
    const stats = await getStats(ctx, sessionId);
    if (stats) await ctx.db.patch("sessionStats", stats._id, { lastHeartbeatAt: Date.now() });
    return null;
  },
});

// ---------- helpers ----------

async function mustGet(ctx: MutationCtx, sessionId: Id<"sessions">) {
  const session = await ctx.db.get("sessions", sessionId);
  if (!session) throw new ConvexError("Session not found");
  return session;
}

export async function mustOwn(ctx: MutationCtx, sessionId: Id<"sessions">, consoleId: string) {
  const session = await mustGet(ctx, sessionId);
  if (session.consoleId !== consoleId) {
    throw new ConvexError("This console no longer owns the session");
  }
  return session;
}

export async function getStats(ctx: MutationCtx, sessionId: Id<"sessions">) {
  return await ctx.db
    .query("sessionStats")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .unique();
}

export const getInternal = internalQuery({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    return await ctx.db.get("sessions", sessionId);
  },
});

// Lets the admin UI validate the password before storing it locally.
export const checkKey = query({
  args: { key: v.string() },
  handler: async (_ctx, { key }) => {
    try {
      requireAdmin(key);
      return true;
    } catch {
      return false;
    }
  },
});

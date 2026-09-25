import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import schema, { langValidator, statusValidator } from "./schema";
import { DEMO_MAX_LIVE_SESSIONS, requireAdmin } from "./lib/auth";
import { requireActiveConference, requireConferenceAdmin } from "./conferences";

const conferenceFilter = v.optional(v.union(v.id("conferences"), v.null()));

async function sessionsFor(ctx: QueryCtx, conferenceId?: Id<"conferences"> | null) {
  return conferenceId === undefined
    ? ctx.db.query("sessions").withIndex("by_creation_time").order("desc").take(200)
    : ctx.db.query("sessions").withIndex("by_conferenceId", (q) => q.eq("conferenceId", conferenceId ?? undefined)).order("desc").take(200);
}

// ---------- Public reads (audience, overlay, dashboard) ----------

export const list = query({
  args: { conferenceId: conferenceFilter },
  returns: v.array(schema.doc("sessions")),
  handler: async (ctx, { conferenceId }) => {
    // A conference has tens of sessions, not thousands: a bounded take is enough.
    const sessions = await sessionsFor(ctx, conferenceId);
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

// Audience reads only running talks, so old talks cannot fill the list window.
export const live = query({
  args: { conferenceId: conferenceFilter },
  returns: v.array(schema.doc("sessions")),
  handler: async (ctx, { conferenceId }) => {
    const groups = await Promise.all((["live", "reconnecting", "paused"] as const).map((status) =>
      conferenceId === undefined
        ? ctx.db.query("sessions").withIndex("by_status", (q) => q.eq("status", status)).order("desc").take(100)
        : ctx.db.query("sessions").withIndex("by_conferenceId_and_status", (q) => q.eq("conferenceId", conferenceId ?? undefined).eq("status", status)).order("desc").take(100),
    ));
    return groups.flat();
  },
});

// Dashboard: sessions joined with their operational stats.
export const dashboard = query({
  args: { conferenceId: conferenceFilter },
  returns: v.array(schema.doc("sessions").extend({ stats: v.union(v.null(), v.object({
    lastHeartbeatAt: v.number(), segmentCount: v.number(), avgLatencyMs: v.union(v.number(), v.null()),
    errorCount: v.number(), reconnectCount: v.number(), lastError: v.union(v.string(), v.null()), lastErrorAt: v.union(v.number(), v.null()),
  })) })),
  handler: async (ctx, { conferenceId }) => {
    const sessions = await sessionsFor(ctx, conferenceId);
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
    conferenceId: v.optional(v.id("conferences")),
  },
  returns: v.id("sessions"),
  handler: async (ctx, { key, ...fields }) => {
    const role = requireAdmin(key);
    if (fields.conferenceId) {
      requireConferenceAdmin(key);
      await requireActiveConference(ctx, fields.conferenceId);
    }
    const targetLangs = [...new Set(fields.targetLangs)].filter((l) => l !== fields.sourceLang);
    const sessionId = await ctx.db.insert("sessions", {
      ...fields,
      targetLangs,
      status: "idle",
      nextSeq: 0,
      code: await uniqueCode(ctx),
      createdBy: role,
    });
    await ctx.db.insert("events", { sessionId, title: fields.title, room: fields.room, type: "created" });
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

export const setConference = mutation({
  args: { key: v.string(), sessionId: v.id("sessions"), conferenceId: v.union(v.id("conferences"), v.null()) },
  returns: v.null(),
  handler: async (ctx, { key, sessionId, conferenceId }) => {
    requireConferenceAdmin(key);
    const session = await mustGet(ctx, sessionId);
    if (["live", "reconnecting", "paused"].includes(session.status)) {
      throw new ConvexError("Finalizá la transmisión antes de cambiar el evento de la sesión");
    }
    if (conferenceId) await requireActiveConference(ctx, conferenceId);
    await ctx.db.patch("sessions", sessionId, { conferenceId: conferenceId ?? undefined });
    return null;
  },
});

export const remove = mutation({
  args: { key: v.string(), sessionId: v.id("sessions") },
  handler: async (ctx, { key, sessionId }) => {
    const role = requireAdmin(key);
    const target = await ctx.db.get("sessions", sessionId);
    if (!target) return null;
    if (role === "demo" && target.createdBy !== "demo") {
      throw new ConvexError("Demo mode can only delete sessions created in demo mode");
    }
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
    const role = requireAdmin(key);
    const session = await mustGet(ctx, sessionId);
    if (session.conferenceId) {
      requireConferenceAdmin(key);
      await requireActiveConference(ctx, session.conferenceId);
    }
    if (role === "demo" && session.status !== "live") {
      const live = await ctx.db
        .query("sessions")
        .withIndex("by_status", (q) => q.eq("status", "live"))
        .take(DEMO_MAX_LIVE_SESSIONS);
      if (live.length >= DEMO_MAX_LIVE_SESSIONS) {
        return {
          ok: false as const,
          reason: `Demo mode allows ${DEMO_MAX_LIVE_SESSIONS} live rooms at a time. Stop one first`,
        };
      }
    }
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
    await logTransition(ctx, session, status, error);
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

/** Writes an alert-log entry when the room's status actually changes (errors always). */
async function logTransition(
  ctx: MutationCtx,
  session: Doc<"sessions">,
  next: Doc<"sessions">["status"],
  error: string | undefined,
) {
  const prev = session.status;
  let type: Doc<"events">["type"] | null = null;
  if (next === "error") type = "error";
  else if (next === prev) type = null;
  else if (next === "live") type = prev === "reconnecting" || prev === "error" ? "recovered" : prev === "paused" ? null : "started";
  else if (next === "reconnecting") type = "reconnecting";
  else if (next === "paused") type = "paused";
  else if (next === "ended") type = "ended";
  if (!type) return;
  await ctx.db.insert("events", {
    sessionId: session._id,
    title: session.title,
    room: session.room,
    type,
    message: error?.slice(0, 300),
  });
}

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
// Returns the role ("admin" | "demo") or null.
export const checkKey = query({
  args: { key: v.string() },
  handler: async (_ctx, { key }) => {
    try {
      return requireAdmin(key);
    } catch {
      return null;
    }
  },
});

export const demoAvailable = query({
  args: {},
  handler: async () => process.env.DEMO_MODE === "true",
});

// Audience entry point: /r/K7Q2 → session.
export const getByCode = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const clean = code.trim().toUpperCase();
    if (!clean) return null;
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", clean))
      .first();
    return session ? { _id: session._id, title: session.title } : null;
  },
});

// One-off migration: give pre-existing sessions a room code.
export const backfillCodes = internalMutation({
  args: {},
  handler: async (ctx) => {
    let n = 0;
    for (const s of await ctx.db.query("sessions").take(500)) {
      if (!s.code) {
        await ctx.db.patch("sessions", s._id, { code: await uniqueCode(ctx) });
        n++;
      }
    }
    return n;
  },
});

// Unambiguous alphabet (no 0/O, 1/I/L) so codes read well off a projector.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

async function uniqueCode(ctx: MutationCtx): Promise<string> {
  for (;;) {
    let code = "";
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    const taken = await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
    if (!taken) return code;
  }
}

// Cron: a running room whose console vanished (laptop closed, crash) never reports it.
// After 60 s without heartbeat, mark it as error and log an alert so production knows.
const NO_SIGNAL_MS = 60_000;
export const markStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let marked = 0;
    for (const status of ["live", "reconnecting", "paused"] as const) {
      const rooms = await ctx.db
        .query("sessions")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(200);
      for (const room of rooms) {
        const stats = await getStats(ctx, room._id);
        if (!stats || now - stats.lastHeartbeatAt < NO_SIGNAL_MS) continue;
        const message = "Sin señal: la consola dejó de responder";
        await ctx.db.patch("sessions", room._id, { status: "error" });
        await ctx.db.patch("sessionStats", stats._id, {
          errorCount: stats.errorCount + 1,
          lastError: message,
          lastErrorAt: now,
        });
        await ctx.db.insert("events", { sessionId: room._id, title: room.title, room: room.room, type: "error", message });
        marked++;
      }
    }
    return marked;
  },
});

// Accessibility: link to a live video of a human sign-language interpreter (e.g. LSA).
export const setInterpreter = mutation({
  args: { key: v.string(), sessionId: v.id("sessions"), url: v.string() },
  handler: async (ctx, { key, sessionId, url }) => {
    requireAdmin(key);
    const clean = url.trim();
    if (clean && !/^https:\/\//i.test(clean)) throw new ConvexError("The interpreter link must start with https://");
    await ctx.db.patch("sessions", sessionId, { interpreterUrl: clean || undefined });
    return null;
  },
});

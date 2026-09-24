import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { langValidator } from "./schema";
import { requireAdmin } from "./lib/auth";
import { getStats, mustOwn } from "./sessions";

// ---------- Console writes ----------

// Overwrite the in-progress line for one language. Called many times per second at most
// a few times (the console throttles), so it lives in its own tiny table.
export const setPartial = mutation({
  args: {
    key: v.string(),
    sessionId: v.id("sessions"),
    consoleId: v.string(),
    lang: langValidator,
    text: v.string(),
  },
  handler: async (ctx, { key, sessionId, consoleId, lang, text }) => {
    requireAdmin(key);
    await mustOwn(ctx, sessionId, consoleId);
    const existing = await ctx.db
      .query("partials")
      .withIndex("by_sessionId_and_lang", (q) => q.eq("sessionId", sessionId).eq("lang", lang))
      .unique();
    if (existing) {
      await ctx.db.patch("partials", existing._id, { text, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("partials", { sessionId, lang, text, updatedAt: Date.now() });
    }
    return null;
  },
});

// Commit a finished line in the talk's original language, then fan out translations.
export const commitSource = mutation({
  args: {
    key: v.string(),
    sessionId: v.id("sessions"),
    consoleId: v.string(),
    text: v.string(),
    startMs: v.number(),
    endMs: v.number(),
    latencyMs: v.optional(v.number()),
    remainingPartial: v.string(), // text already heard after this line (next line's start)
  },
  handler: async (ctx, args) => {
    requireAdmin(args.key);
    const session = await mustOwn(ctx, args.sessionId, args.consoleId);
    const text = args.text.trim();
    if (!text) return null;

    const seq = session.nextSeq;
    await ctx.db.patch("sessions", session._id, { nextSeq: seq + 1 });
    const segmentId = await ctx.db.insert("segments", {
      sessionId: session._id,
      lang: session.sourceLang,
      seq,
      text,
      startMs: args.startMs,
      endMs: args.endMs,
      isSource: true,
      latencyMs: args.latencyMs,
    });

    // Keep the partial line in sync so viewers never see the committed text twice.
    const partial = await ctx.db
      .query("partials")
      .withIndex("by_sessionId_and_lang", (q) =>
        q.eq("sessionId", session._id).eq("lang", session.sourceLang),
      )
      .unique();
    if (partial) {
      await ctx.db.patch("partials", partial._id, {
        text: args.remainingPartial,
        updatedAt: Date.now(),
      });
    }

    const stats = await getStats(ctx, session._id);
    if (stats) {
      await ctx.db.patch("sessionStats", stats._id, {
        segmentCount: stats.segmentCount + 1,
        lastHeartbeatAt: Date.now(),
        ...(args.latencyMs !== undefined
          ? {
              latencySumMs: stats.latencySumMs + args.latencyMs,
              latencyCount: stats.latencyCount + 1,
            }
          : {}),
      });
    }

    for (const lang of session.targetLangs) {
      await ctx.scheduler.runAfter(0, internal.gemini.translateSegment, {
        segmentId,
        targetLang: lang,
        committedAt: Date.now(),
      });
    }
    return seq;
  },
});

// ---------- Internal (used by the translation action) ----------

export const translationContext = internalQuery({
  args: { segmentId: v.id("segments") },
  handler: async (ctx, { segmentId }) => {
    const segment = await ctx.db.get("segments", segmentId);
    if (!segment) return null;
    // A few previous lines give the translator context (pronouns, split sentences).
    const previous = await ctx.db
      .query("segments")
      .withIndex("by_sessionId_and_lang_and_seq", (q) =>
        q.eq("sessionId", segment.sessionId).eq("lang", segment.lang).lt("seq", segment.seq),
      )
      .order("desc")
      .take(3);
    const glossary = await ctx.db.query("glossary").take(300);
    return {
      segment,
      previous: previous.reverse().map((s) => s.text),
      glossary: glossary.map((g) => ({ term: g.term, translations: g.translations ?? {} })),
    };
  },
});

export const insertTranslation = internalMutation({
  args: {
    sourceId: v.id("segments"),
    lang: langValidator,
    text: v.string(),
    latencyMs: v.optional(v.number()),
  },
  handler: async (ctx, { sourceId, lang, text, latencyMs }) => {
    const source = await ctx.db.get("segments", sourceId);
    if (!source) return null;
    await ctx.db.insert("segments", {
      sessionId: source.sessionId,
      lang,
      seq: source.seq,
      text: text.trim(),
      startMs: source.startMs,
      endMs: source.endMs,
      isSource: false,
      latencyMs,
    });
    return null;
  },
});

export const recordError = internalMutation({
  args: { sessionId: v.id("sessions"), error: v.string() },
  handler: async (ctx, { sessionId, error }) => {
    const stats = await getStats(ctx, sessionId);
    if (stats) {
      await ctx.db.patch("sessionStats", stats._id, {
        errorCount: stats.errorCount + 1,
        lastError: error.slice(0, 500),
        lastErrorAt: Date.now(),
      });
    }
    return null;
  },
});

// ---------- Public reads ----------

// Live feed for audience view and OBS overlay: last N final lines + the in-progress line.
export const feed = query({
  args: { sessionId: v.id("sessions"), lang: langValidator, limit: v.optional(v.number()) },
  handler: async (ctx, { sessionId, lang, limit }) => {
    const lines = await ctx.db
      .query("segments")
      .withIndex("by_sessionId_and_lang_and_seq", (q) =>
        q.eq("sessionId", sessionId).eq("lang", lang),
      )
      .order("desc")
      .take(Math.min(limit ?? 50, 200));
    const partial = await ctx.db
      .query("partials")
      .withIndex("by_sessionId_and_lang", (q) => q.eq("sessionId", sessionId).eq("lang", lang))
      .unique();
    return {
      lines: lines.reverse().map((l) => ({ seq: l.seq, text: l.text, startMs: l.startMs })),
      partial: partial?.text ?? "",
    };
  },
});

// Full transcript for SRT / VTT / TXT export. Bounded to ~4h of talk.
export const transcript = query({
  args: { sessionId: v.id("sessions"), lang: langValidator },
  handler: async (ctx, { sessionId, lang }) => {
    const lines = await ctx.db
      .query("segments")
      .withIndex("by_sessionId_and_lang_and_seq", (q) =>
        q.eq("sessionId", sessionId).eq("lang", lang),
      )
      .take(5000);
    return lines.map((l) => ({ seq: l.seq, text: l.text, startMs: l.startMs, endMs: l.endMs }));
  },
});

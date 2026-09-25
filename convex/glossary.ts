import { v } from "convex/values";
import { internalQuery, mutation, query, QueryCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireAdmin } from "./lib/auth";

const MAX_TERMS = 300;

/** Event-wide terms plus, if given, the terms of one session. */
async function termsFor(ctx: QueryCtx, sessionId?: Id<"sessions">) {
  const eventWide = await ctx.db
    .query("glossary")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", undefined))
    .take(MAX_TERMS);
  const perSession = sessionId
    ? await ctx.db
        .query("glossary")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
        .take(MAX_TERMS)
    : [];
  return [...eventWide, ...perSession];
}

/** Admin list: every term, with the title of the session it belongs to (if any). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("glossary").take(MAX_TERMS * 3);
    const titles = new Map<string, string>();
    for (const r of rows) {
      if (r.sessionId && !titles.has(r.sessionId)) {
        titles.set(r.sessionId, (await ctx.db.get("sessions", r.sessionId))?.title ?? "—");
      }
    }
    return rows.map((r) => ({ ...r, sessionTitle: r.sessionId ? titles.get(r.sessionId) : undefined }));
  },
});

export const listInternal = internalQuery({
  args: { sessionId: v.optional(v.id("sessions")) },
  handler: async (ctx, { sessionId }) => termsFor(ctx, sessionId),
});

export const add = mutation({
  args: {
    key: v.string(),
    term: v.string(),
    translations: v.optional(v.record(v.string(), v.string())),
    sessionId: v.optional(v.id("sessions")),
  },
  handler: async (ctx, { key, term, translations, sessionId }) => {
    requireAdmin(key);
    const clean = term.trim();
    if (!clean) return null;
    return await ctx.db.insert("glossary", { term: clean, translations, sessionId });
  },
});

/** Bulk insert from the "import from slides" review screen. Skips duplicates. */
export const addMany = mutation({
  args: {
    key: v.string(),
    sessionId: v.optional(v.id("sessions")),
    terms: v.array(v.object({ term: v.string(), translations: v.optional(v.record(v.string(), v.string())) })),
  },
  handler: async (ctx, { key, sessionId, terms }) => {
    requireAdmin(key);
    const existing = new Set((await termsFor(ctx, sessionId)).map((t) => t.term.toLowerCase()));
    let added = 0;
    for (const t of terms.slice(0, 100)) {
      const clean = t.term.trim();
      if (!clean || existing.has(clean.toLowerCase())) continue;
      existing.add(clean.toLowerCase());
      const translations = Object.fromEntries(
        Object.entries(t.translations ?? {}).filter(([, val]) => val.trim() && val.trim() !== clean),
      );
      await ctx.db.insert("glossary", {
        term: clean,
        translations: Object.keys(translations).length ? translations : undefined,
        sessionId,
      });
      added++;
    }
    return added;
  },
});

export const remove = mutation({
  args: { key: v.string(), id: v.id("glossary") },
  handler: async (ctx, { key, id }) => {
    requireAdmin(key);
    await ctx.db.delete("glossary", id);
    return null;
  },
});

/** Short-lived URL the admin UI uploads the slides PDF to (Convex file storage). */
export const generateUploadUrl = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    requireAdmin(key);
    return await ctx.storage.generateUploadUrl();
  },
});

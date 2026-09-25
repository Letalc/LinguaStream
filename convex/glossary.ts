import { ConvexError, v } from "convex/values";
import { internalQuery, mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { requireAdmin } from "./lib/auth";
import { requireActiveConference, requireConferenceAdmin } from "./conferences";

const MAX_TERMS = 300;
const scopeArgs = { sessionId: v.optional(v.id("sessions")), conferenceId: v.optional(v.id("conferences")) };
type Scope = { sessionId?: Id<"sessions">; conferenceId?: Id<"conferences"> };

/** Session terms follow their talk; conference terms never spill into another event. */
async function termsFor(ctx: QueryCtx, { sessionId, conferenceId }: Scope) {
  if (sessionId) {
    const session = await ctx.db.get("sessions", sessionId);
    if (!session) throw new ConvexError("La sesión no existe");
    if (conferenceId && conferenceId !== session.conferenceId) throw new ConvexError("La sesión pertenece a otro evento");
    conferenceId = session.conferenceId;
  }
  const shared = await ctx.db.query("glossary")
    .withIndex("by_conferenceId_and_sessionId", (q) => q.eq("conferenceId", conferenceId).eq("sessionId", undefined))
    .take(MAX_TERMS);
  const perSession = sessionId
    ? await ctx.db.query("glossary").withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId)).take(MAX_TERMS)
    : [];
  return [...shared, ...perSession];
}

async function writeScope(ctx: MutationCtx, key: string, { sessionId, conferenceId }: Scope): Promise<Scope> {
  const role = requireAdmin(key);
  if (sessionId) {
    const session = await ctx.db.get("sessions", sessionId);
    if (!session) throw new ConvexError("La sesión no existe");
    if (conferenceId && conferenceId !== session.conferenceId) throw new ConvexError("La sesión pertenece a otro evento");
    if (role === "demo" && (session.createdBy !== "demo" || session.conferenceId)) {
      throw new ConvexError("La demo solo puede modificar el glosario de sus propias sesiones sin evento");
    }
    if (session.conferenceId) await requireActiveConference(ctx, session.conferenceId);
    return { sessionId }; // no denormalized conferenceId to maintain on reassignment
  }
  requireConferenceAdmin(key);
  if (conferenceId) await requireActiveConference(ctx, conferenceId);
  return { conferenceId };
}

function cleanTerm(term: string) {
  const clean = term.trim();
  if (clean.length > 160) throw new ConvexError("Cada término admite hasta 160 caracteres");
  return clean;
}

export const list = query({
  args: { key: v.optional(v.string()), ...scopeArgs },
  returns: v.array(schema.doc("glossary").extend({ sessionTitle: v.optional(v.string()) })),
  handler: async (ctx, { key, ...scope }) => {
    if (key) requireAdmin(key);
    const rows = await termsFor(ctx, scope);
    const title = scope.sessionId ? (await ctx.db.get("sessions", scope.sessionId))?.title : undefined;
    return rows.map((r) => ({ ...r, sessionTitle: r.sessionId ? title : undefined }));
  },
});

export const listInternal = internalQuery({
  args: { sessionId: v.optional(v.id("sessions")) },
  returns: v.array(schema.doc("glossary")),
  handler: async (ctx, scope) => termsFor(ctx, scope),
});

export const add = mutation({
  args: { key: v.string(), term: v.string(), translations: v.optional(v.record(v.string(), v.string())), ...scopeArgs },
  returns: v.union(v.id("glossary"), v.null()),
  handler: async (ctx, { key, term, translations, ...scope }) => {
    const target = await writeScope(ctx, key, scope);
    const clean = cleanTerm(term);
    if (!clean) return null;
    const existing = await termsFor(ctx, scope);
    if (existing.some((t) => t.term.toLowerCase() === clean.toLowerCase())) return null;
    if (existing.filter((t) => t.sessionId === target.sessionId).length >= MAX_TERMS) throw new ConvexError("El glosario alcanzó el límite de 300 términos para este alcance");
    return ctx.db.insert("glossary", { term: clean, translations, ...target });
  },
});

export const addMany = mutation({
  args: { key: v.string(), ...scopeArgs, terms: v.array(v.object({ term: v.string(), translations: v.optional(v.record(v.string(), v.string())) })) },
  returns: v.number(),
  handler: async (ctx, { key, terms, ...scope }) => {
    const target = await writeScope(ctx, key, scope);
    if (terms.length > 100) throw new ConvexError("Importá hasta 100 términos a la vez");
    const current = await termsFor(ctx, scope);
    const existing = new Set(current.map((t) => t.term.toLowerCase()));
    let count = current.filter((t) => t.sessionId === target.sessionId).length;
    let added = 0;
    for (const t of terms) {
      const clean = cleanTerm(t.term);
      if (!clean || existing.has(clean.toLowerCase())) continue;
      if (count >= MAX_TERMS) throw new ConvexError("El glosario alcanzó el límite de 300 términos para este alcance");
      existing.add(clean.toLowerCase());
      const translations = Object.fromEntries(Object.entries(t.translations ?? {}).filter(([, val]) => val.trim() && val.trim() !== clean));
      await ctx.db.insert("glossary", { term: clean, translations: Object.keys(translations).length ? translations : undefined, ...target });
      added++;
      count++;
    }
    return added;
  },
});

export const remove = mutation({
  args: { key: v.string(), id: v.id("glossary") },
  returns: v.null(),
  handler: async (ctx, { key, id }) => {
    const term = await ctx.db.get("glossary", id);
    if (!term) { requireAdmin(key); return null; }
    await writeScope(ctx, key, term);
    await ctx.db.delete("glossary", id);
    return null;
  },
});

export const generateUploadUrl = mutation({
  args: { key: v.string() },
  returns: v.string(),
  handler: async (ctx, { key }) => {
    requireAdmin(key);
    return ctx.storage.generateUploadUrl();
  },
});

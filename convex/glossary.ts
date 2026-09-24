import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("glossary").take(300);
  },
});

export const listInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("glossary").take(300);
  },
});

export const add = mutation({
  args: {
    key: v.string(),
    term: v.string(),
    translations: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, { key, term, translations }) => {
    requireAdmin(key);
    const clean = term.trim();
    if (!clean) return null;
    return await ctx.db.insert("glossary", { term: clean, translations });
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

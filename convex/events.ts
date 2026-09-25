import { v } from "convex/values";
import { query } from "./_generated/server";

/** Latest alert-log entries for the production dashboard (newest first). */
export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    return await ctx.db
      .query("events")
      .order("desc")
      .take(Math.min(limit ?? 20, 100));
  },
});

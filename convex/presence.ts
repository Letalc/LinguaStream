import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { v } from "convex/values";
import { Presence } from "@convex-dev/presence";
import { Id } from "./_generated/dataModel";
import { requireAdmin } from "./lib/auth";

export const presence = new Presence<Id<"sessions">, string>(components.presence);

const HEARTBEAT_MS = 60_000;
const COUNT_LIMIT = 1_000;

export const heartbeat = mutation({
  args: {
    roomId: v.id("sessions"),
    userId: v.string(),
    sessionId: v.string(),
  },
  returns: v.object({ roomToken: v.string(), sessionToken: v.string() }),
  handler: async (ctx, { roomId, userId, sessionId }) => {
    if (!(await ctx.db.get("sessions", roomId))) throw new Error("Session not found");
    if (userId.length > 100 || sessionId.length > 100) throw new Error("Invalid presence identifier");
    return await presence.heartbeat(ctx, roomId, userId, sessionId, HEARTBEAT_MS);
  },
});

export const count = query({
  args: { key: v.string(), roomId: v.id("sessions") },
  returns: v.object({ count: v.number(), capped: v.boolean() }),
  handler: async (ctx, { key, roomId }) => {
    requireAdmin(key);
    const users = await presence.listRoom(ctx, roomId, true, COUNT_LIMIT + 1);
    return { count: Math.min(users.length, COUNT_LIMIT), capped: users.length > COUNT_LIMIT };
  },
});

export const disconnect = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionToken }) => {
    return await presence.disconnect(ctx, sessionToken);
  },
});

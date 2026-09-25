import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Languages supported for input and output subtitles.
export const langValidator = v.union(v.literal("es"), v.literal("en"), v.literal("pt"));

export const statusValidator = v.union(
  v.literal("idle"), // created, no console connected yet
  v.literal("live"), // console streaming audio to Gemini
  v.literal("reconnecting"), // Gemini connection dropped, console retrying
  v.literal("paused"),
  v.literal("error"),
  v.literal("ended"),
);

export default defineSchema({
  // Conference metadata is separate from the operational `events` alert log.
  conferences: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("archived")),
  }).index("by_status", ["status"]),

  // One row per talk. Low-churn data only (high-churn metrics live in sessionStats).
  sessions: defineTable({
    conferenceId: v.optional(v.id("conferences")), // existing sessions stay unassigned
    title: v.string(),
    room: v.string(),
    speaker: v.optional(v.string()),
    sourceLang: langValidator,
    targetLangs: v.array(langValidator), // translations to produce (never includes sourceLang)
    status: statusValidator,
    startedAt: v.optional(v.number()), // wall clock when audio started (ms)
    endedAt: v.optional(v.number()),
    nextSeq: v.number(), // counter for final source segments
    consoleId: v.optional(v.string()), // random id of the console tab that owns the session
    code: v.optional(v.string()), // short room code for the audience, e.g. "K7Q2" (QR / link)
    createdBy: v.optional(v.union(v.literal("admin"), v.literal("demo"))),
    interpreterUrl: v.optional(v.string()), // live video of a human sign-language (LSA) interpreter
    scheduledAt: v.optional(v.number()), // planned start (ms), optional, shown to the audience and the dashboard
  })
    .index("by_status", ["status"])
    .index("by_code", ["code"])
    .index("by_conferenceId", ["conferenceId"])
    .index("by_conferenceId_and_status", ["conferenceId", "status"]),

  // Immutable, finalized subtitle lines. Source lines and their translations share `seq`.
  segments: defineTable({
    sessionId: v.id("sessions"),
    lang: langValidator,
    seq: v.number(),
    text: v.string(),
    startMs: v.number(), // offset from session start
    endMs: v.number(),
    isSource: v.boolean(),
    latencyMs: v.optional(v.number()), // end of speech -> text available
  })
    .index("by_sessionId_and_lang_and_seq", ["sessionId", "lang", "seq"])
    .index("by_sessionId_and_seq", ["sessionId", "seq"]),

  // The in-progress (not yet final) line per session+language. Overwritten constantly.
  partials: defineTable({
    sessionId: v.id("sessions"),
    lang: langValidator,
    text: v.string(),
    updatedAt: v.number(),
    receivedAt: v.optional(v.number()), // console clock when Gemini produced the text
  }).index("by_sessionId_and_lang", ["sessionId", "lang"]),

  // High-churn operational metrics for the production dashboard.
  sessionStats: defineTable({
    sessionId: v.id("sessions"),
    lastHeartbeatAt: v.number(),
    segmentCount: v.number(),
    latencySumMs: v.number(),
    latencyCount: v.number(),
    errorCount: v.number(),
    reconnectCount: v.number(),
    lastError: v.optional(v.string()),
    lastErrorAt: v.optional(v.number()),
  }).index("by_sessionId", ["sessionId"]),

  // Operational alert log for the production dashboard (status transitions).
  events: defineTable({
    sessionId: v.id("sessions"),
    title: v.string(), // denormalized so the log survives session deletion
    room: v.string(),
    type: v.union(
      v.literal("created"),
      v.literal("started"),
      v.literal("recovered"),
      v.literal("reconnecting"),
      v.literal("paused"),
      v.literal("error"),
      v.literal("ended"),
    ),
    message: v.optional(v.string()),
  }),

  // Conference terms have conferenceId only; per-talk terms have sessionId only.
  // Legacy terms with neither id apply exclusively to unassigned sessions.
  glossary: defineTable({
    term: v.string(),
    // Optional forced translations, e.g. { es: "despliegue" }. Empty = keep term as-is.
    translations: v.optional(v.record(v.string(), v.string())),
    sessionId: v.optional(v.id("sessions")),
    conferenceId: v.optional(v.id("conferences")),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_conferenceId_and_sessionId", ["conferenceId", "sessionId"]),
});

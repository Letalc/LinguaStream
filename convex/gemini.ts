"use node";

import { GoogleGenAI, Modality } from "@google/genai";
import { ConvexError, v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { requireAdmin } from "./lib/auth";

// Model names are configurable via Convex env vars so a conference can switch models
// without touching code (`npx convex env set GEMINI_LIVE_MODEL ...`).
const LIVE_MODEL = () => process.env.GEMINI_LIVE_MODEL ?? "gemini-live-2.5-flash-preview";
const TEXT_MODEL = () => process.env.GEMINI_TEXT_MODEL ?? "gemini-flash-lite-latest";

const LANG_NAMES: Record<string, string> = { es: "Spanish", en: "English", pt: "Portuguese" };

function client() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ConvexError("GEMINI_API_KEY is not configured in Convex");
  return new GoogleGenAI({ apiKey });
}

/**
 * Mints a short-lived Gemini token for the room console, so the browser can stream
 * audio straight to the Live API without ever seeing the real API key.
 * Returns the model + config the console must use to connect.
 */
export const createLiveToken = action({
  args: { key: v.string(), sessionId: v.id("sessions") },
  handler: async (
    ctx,
    { key, sessionId },
  ): Promise<{ token: string; model: string; config: Record<string, unknown> }> => {
    requireAdmin(key);
    const session: Doc<"sessions"> | null = await ctx.runQuery(internal.sessions.getInternal, { sessionId });
    if (!session) throw new ConvexError("Session not found");

    const glossary: { term: string }[] = await ctx.runQuery(internal.glossary.listInternal, {});
    const terms = glossary.map((g) => g.term);

    const model = LIVE_MODEL();
    const config: Record<string, unknown> = {
      responseModalities: [Modality.TEXT],
      // The model's own replies are ignored; we only want the input transcription.
      systemInstruction:
        "You are a silent speech transcription engine for a live conference talk. " +
        "Never answer, comment or translate. If you must respond, respond with a single period.",
      inputAudioTranscription: {
        languageCodes: [session.sourceLang],
        ...(terms.length ? { customVocabulary: terms } : {}),
      },
      // Long talks: compress context and allow resuming after the server's periodic GoAway.
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: {},
    };

    const now = Date.now();
    const token = await client().authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(),
        httpOptions: { apiVersion: "v1alpha" },
      },
    });
    if (!token.name) throw new ConvexError("Gemini did not return a token");
    return { token: token.name, model, config };
  },
});

/** Translates one finalized source line into one target language. */
export const translateSegment = internalAction({
  args: {
    segmentId: v.id("segments"),
    targetLang: v.union(v.literal("es"), v.literal("en"), v.literal("pt")),
    committedAt: v.number(),
  },
  handler: async (ctx, { segmentId, targetLang, committedAt }): Promise<null> => {
    const data: {
      segment: Doc<"segments">;
      previous: string[];
      glossary: { term: string; translations: Record<string, string> }[];
    } | null = await ctx.runQuery(internal.segments.translationContext, { segmentId });
    if (!data) return null;
    const { segment, previous, glossary } = data;

    const glossaryLines = glossary
      .map((g) => {
        const forced = g.translations[targetLang];
        return forced ? `- "${g.term}" → "${forced}"` : `- "${g.term}" (keep as-is)`;
      })
      .join("\n");

    const prompt = [
      `Translate the LAST LINE of a live tech-conference talk from ${LANG_NAMES[segment.lang]} to ${LANG_NAMES[targetLang]}.`,
      `Output ONLY the translation of the last line, as subtitles: natural, concise, no quotes, no notes.`,
      `Keep code identifiers, product names and people's names unchanged.`,
      glossaryLines ? `Glossary (must follow):\n${glossaryLines}` : "",
      previous.length ? `Previous lines (context only, do not translate):\n${previous.join("\n")}` : "",
      `LAST LINE:\n${segment.text}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      const res = await client().models.generateContent({
        model: TEXT_MODEL(),
        contents: prompt,
        config: { temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } },
      });
      const text = res.text?.trim();
      if (!text) throw new Error("Empty translation");
      // Latency = source line latency + time spent translating.
      const sourceLatency = segment.latencyMs ?? 0;
      await ctx.runMutation(internal.segments.insertTranslation, {
        sourceId: segmentId,
        lang: targetLang,
        text,
        latencyMs: sourceLatency + (Date.now() - committedAt),
      });
    } catch (e) {
      await ctx.runMutation(internal.segments.recordError, {
        sessionId: segment.sessionId,
        error: `translate→${targetLang}: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    return null;
  },
});

"use node";

import { GoogleGenAI, Modality } from "@google/genai";
import { ConvexError, v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { DEMO_MAX_SESSION_MS, requireAdmin } from "./lib/auth";

// Model names are configurable via Convex env vars so a conference can switch models
// without touching code (`npx convex env set GEMINI_LIVE_MODEL ...`).
const LIVE_MODEL = () => process.env.GEMINI_LIVE_MODEL ?? "gemini-3.5-live-translate-preview";
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
 * One token (and one Live connection) per target language.
 */
export const createLiveToken = action({
  args: {
    key: v.string(),
    sessionId: v.id("sessions"),
    targetLang: v.union(v.literal("es"), v.literal("en"), v.literal("pt")),
  },
  handler: async (
    ctx,
    { key, sessionId, targetLang },
  ): Promise<{ token: string; model: string; config: Record<string, unknown> }> => {
    const role = requireAdmin(key);
    const session: Doc<"sessions"> | null = await ctx.runQuery(internal.sessions.getInternal, {
      sessionId,
    });
    if (!session) throw new ConvexError("Session not found");
    if (role === "demo" && session.startedAt && Date.now() - session.startedAt > DEMO_MAX_SESSION_MS) {
      throw new ConvexError("Demo sessions are limited to 20 minutes. Create a new session to keep testing.");
    }

    const glossary: { term: string; translations?: Record<string, string> }[] =
      await ctx.runQuery(internal.glossary.listInternal, {});

    const model = LIVE_MODEL();
    const config: Record<string, unknown> = {
      responseModalities: [Modality.TEXT],
      inputAudioTranscription: glossary.length
        ? { customVocabulary: glossary.map((g) => g.term) }
        : {},
      translationConfig: { targetLanguageCode: targetLang },
      // Long talks: server-side context compression + resumable sessions.
      contextWindowCompression: { slidingWindow: {} },
      ...(glossary.length ? { systemInstruction: glossaryInstruction(glossary, targetLang) } : {}),
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

// Tested: the live-translate model follows a glossary given as system instruction
// (e.g. it writes "Nerdearla" instead of "Nerdierla").
function glossaryInstruction(
  glossary: { term: string; translations?: Record<string, string> }[],
  targetLang: string,
) {
  const lines = glossary.map((g) => {
    const forced = g.translations?.[targetLang];
    return forced ? `- ${g.term} → ${forced}` : `- ${g.term} (proper noun / technical term, keep as-is)`;
  });
  return `Glossary for this tech conference. Spell and translate these terms exactly like this:\n${lines.join("\n")}`;
}

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

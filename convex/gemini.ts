"use node";

import { GoogleGenAI, Modality, Type } from "@google/genai";
import { ConvexError, v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { DEMO_MAX_SESSION_MS, requireAdmin } from "./lib/auth";

// Model names are configurable via Convex env vars so a conference can switch models
// without touching code (`npx convex env set GEMINI_LIVE_MODEL ...`).
const LIVE_MODEL = () => process.env.GEMINI_LIVE_MODEL ?? "gemini-3.5-live-translate-preview";
const TEXT_MODEL = () => process.env.GEMINI_TEXT_MODEL ?? "gemini-flash-lite-latest";
// Tried in order: popular models return 503 "high demand" at peak times.
const EXTRACT_MODELS = () =>
  [process.env.GEMINI_EXTRACT_MODEL, "gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-3.5-flash", "gemini-flash-latest"].filter(
    (m, i, all): m is string => !!m && all.indexOf(m) === i,
  );

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
      await ctx.runQuery(internal.glossary.listInternal, { sessionId });

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

// ---------- Glossary extraction from the talk's slides ----------

const MAX_PDF_BYTES = 20 * 1024 * 1024; // inline request limit

export type ExtractedTerm = {
  term: string;
  kind: "proper_noun" | "technical" | "acronym";
  translations: { es?: string; en?: string; pt?: string };
};

/**
 * Reads a slides PDF (uploaded to Convex storage, or a public Google Slides/Docs link)
 * and asks Gemini for the terms that speech recognition and translation tend to get
 * wrong. Returns candidates for the admin to review; nothing is saved here.
 */
export const extractGlossary = action({
  args: {
    key: v.string(),
    storageId: v.optional(v.id("_storage")),
    url: v.optional(v.string()),
  },
  handler: async (ctx, { key, storageId, url }): Promise<ExtractedTerm[]> => {
    requireAdmin(key);
    let pdf: ArrayBuffer;
    if (storageId) {
      const blob = await ctx.storage.get(storageId);
      if (!blob) throw new ConvexError("Uploaded file not found");
      pdf = await blob.arrayBuffer();
      await ctx.storage.delete(storageId); // we only needed it for this extraction
    } else if (url) {
      pdf = await fetchPublicPdf(url);
    } else {
      throw new ConvexError("Send a PDF or a Google Slides link");
    }
    if (pdf.byteLength > MAX_PDF_BYTES) throw new ConvexError("The PDF is larger than 20 MB");
    if (!isPdf(pdf)) throw new ConvexError("The file is not a PDF (export your slides as PDF)");

    const request = (model: string) => ({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "application/pdf", data: Buffer.from(pdf).toString("base64") } },
            {
              text:
                "These are the slides of a tech-conference talk. Build a glossary for a live " +
                "speech-recognition + simultaneous-translation system. Extract up to 60 terms that " +
                "an ASR model could misspell or a translator could wrongly translate: people's names, " +
                "companies, products, projects, tools, programming languages, acronyms and domain jargon. " +
                "Skip common everyday words. For each term give how it should be written in Spanish (es), " +
                "English (en) and Portuguese (pt) subtitles — usually identical to the term for proper " +
                "nouns and product names.",
            },
          ],
        },
      ],
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            terms: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  term: { type: Type.STRING },
                  kind: { type: Type.STRING, enum: ["proper_noun", "technical", "acronym"] },
                  es: { type: Type.STRING },
                  en: { type: Type.STRING },
                  pt: { type: Type.STRING },
                },
                required: ["term", "kind"],
              },
            },
          },
          required: ["terms"],
        },
        httpOptions: { timeout: 25_000 },
      },
    });

    let res: Awaited<ReturnType<ReturnType<typeof client>["models"]["generateContent"]>> | null = null;
    let lastError = "";
    for (const model of EXTRACT_MODELS()) {
      try {
        res = await client().models.generateContent(request(model));
        break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        console.warn(`extractGlossary: ${model} failed, trying next`, lastError.slice(0, 200));
      }
    }
    if (!res) throw new ConvexError(`Gemini is busy right now, try again in a minute (${lastError.slice(0, 120)})`);

    let parsed: { terms?: { term: string; kind: ExtractedTerm["kind"]; es?: string; en?: string; pt?: string }[] };
    try {
      parsed = JSON.parse(res.text ?? "{}");
    } catch {
      throw new ConvexError("Gemini returned an unreadable glossary, try again");
    }
    const seen = new Set<string>();
    return (parsed.terms ?? [])
      .filter((t) => t.term?.trim() && !seen.has(t.term.toLowerCase()) && seen.add(t.term.toLowerCase()))
      .slice(0, 60)
      .map((t) => ({ term: t.term.trim(), kind: t.kind, translations: { es: t.es, en: t.en, pt: t.pt } }));
  },
});

/** Google Slides / Docs links → their public PDF export. Any other URL must be a PDF. */
async function fetchPublicPdf(raw: string): Promise<ArrayBuffer> {
  let url = raw.trim();
  const g = /docs\.google\.com\/(presentation|document)\/d\/([a-zA-Z0-9_-]+)/.exec(url);
  if (g) url = `https://docs.google.com/${g[1]}/d/${g[2]}/export/pdf`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new ConvexError(`Could not download the file (HTTP ${res.status})`);
  const buf = await res.arrayBuffer();
  if (!isPdf(buf)) {
    throw new ConvexError(
      g
        ? 'The presentation is not public. Share it as "Anyone with the link can view", or upload the PDF.'
        : "The link does not point to a PDF",
    );
  }
  return buf;
}

function isPdf(buf: ArrayBuffer) {
  const head = new Uint8Array(buf.slice(0, 5));
  return String.fromCharCode(...head) === "%PDF-";
}

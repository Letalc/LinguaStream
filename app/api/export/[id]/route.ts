import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

type Line = { seq: number; text: string; startMs: number; endMs: number };

// GET /api/export/<sessionId>?lang=es&format=srt|vtt|txt
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const lang = url.searchParams.get("lang") ?? "es";
  const format = url.searchParams.get("format") ?? "srt";
  if (!["es", "en", "pt"].includes(lang) || !["srt", "vtt", "txt"].includes(format)) {
    return new Response("Invalid lang or format", { status: 400 });
  }

  const sessionId = id as Id<"sessions">;
  let session, lines: Line[];
  try {
    session = await convex.query(api.sessions.get, { sessionId });
    lines = await convex.query(api.segments.transcript, { sessionId, lang: lang as "es" | "en" | "pt" });
  } catch {
    return new Response("Session not found", { status: 404 });
  }
  if (!session) return new Response("Session not found", { status: 404 });

  const body = format === "txt" ? toTxt(lines) : format === "vtt" ? toVtt(lines) : toSrt(lines);
  const slug = session.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "session";
  const types = { srt: "application/x-subrip", vtt: "text/vtt", txt: "text/plain" };
  return new Response(body, {
    headers: {
      "Content-Type": `${types[format as keyof typeof types]}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${slug}.${lang}.${format}"`,
    },
  });
}

// Subtitle cues must not overlap and should stay on screen long enough to read.
function cues(lines: Line[]) {
  return lines.map((l, i) => {
    const start = l.startMs;
    const next = lines[i + 1]?.startMs ?? Infinity;
    const end = Math.min(Math.max(l.endMs, start + 1500), next);
    return { n: i + 1, start, end: Math.max(end, start + 500), text: l.text };
  });
}

function ts(ms: number, sep: "," | ".") {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = Math.floor(ms % 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(r, 3)}`;
}

function toSrt(lines: Line[]) {
  return cues(lines).map((c) => `${c.n}\n${ts(c.start, ",")} --> ${ts(c.end, ",")}\n${c.text}\n`).join("\n");
}

function toVtt(lines: Line[]) {
  return "WEBVTT\n\n" + cues(lines).map((c) => `${ts(c.start, ".")} --> ${ts(c.end, ".")}\n${c.text}\n`).join("\n");
}

function toTxt(lines: Line[]) {
  return lines.map((l) => `[${ts(l.startMs, ".").slice(0, 8)}] ${l.text}`).join("\n") + "\n";
}

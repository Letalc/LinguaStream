"use client";

import { useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { Suspense, use } from "react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { isLang } from "@/lib/langs";

/**
 * OBS / vMix Browser Source. Transparent page, last lines at the bottom.
 * Query params: lang (es|en|pt), size (px, default 42), lines (default 2),
 * bg (1 = semi-transparent box behind text, default 1), color (hex without #).
 */
export default function OverlayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <Overlay sessionId={id as Id<"sessions">} />
    </Suspense>
  );
}

function Overlay({ sessionId }: { sessionId: Id<"sessions"> }) {
  const q = useSearchParams();
  const langParam = q.get("lang");
  const lang = isLang(langParam) ? langParam : "es";
  const size = Number(q.get("size") ?? 42);
  const maxLines = Number(q.get("lines") ?? 2);
  const box = q.get("bg") !== "0";
  const color = `#${(q.get("color") ?? "ffffff").replace(/[^0-9a-f]/gi, "")}`;

  const feed = useQuery(api.segments.feed, { sessionId, lang, limit: maxLines });
  const lines = [...(feed?.lines.map((l) => l.text) ?? []), ...(feed?.partial ? [feed.partial] : [])].slice(-maxLines);

  return (
    <div className="overlay-root fixed inset-0 flex flex-col items-center justify-end p-8">
      {lines.length > 0 && (
        <div
          className="max-w-[90vw] rounded-xl px-6 py-3 text-center font-semibold leading-snug"
          style={{
            fontSize: size,
            color,
            background: box ? "rgba(0,0,0,0.65)" : "transparent",
            textShadow: box ? "none" : "0 2px 6px #000, 0 0 2px #000",
          }}
        >
          {lines.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
      )}
    </div>
  );
}

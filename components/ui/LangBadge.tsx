import type { Lang } from "@/lib/langs";

/** Language shown as its ISO code in a small badge (replaces flag emojis). */
export function LangBadge({ code, className = "" }: { code: Lang; className?: string }) {
  return (
    <span
      className={`inline-flex h-6 min-w-8 items-center justify-center rounded-sm border border-current/40 px-1.5 font-mono text-[11px] font-semibold tracking-wider ${className}`}
    >
      {code.toUpperCase()}
    </span>
  );
}

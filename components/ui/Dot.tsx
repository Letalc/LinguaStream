/** Small round status indicator (CSS, not a text glyph). */
export function Dot({ className = "bg-current", pulse = false }: { className?: string; pulse?: boolean }) {
  return <span aria-hidden className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${className} ${pulse ? "animate-pulse" : ""}`} />;
}

/**
 * Turns a video link into something embeddable in an <iframe>.
 * YouTube (watch?v=, youtu.be/, /live/, /shorts/, /embed/) → privacy-friendly embed,
 * autoplaying muted (browsers block autoplay with sound; a sign interpreter needs none).
 * Any other https link is embedded as-is (Vimeo player, Jitsi, a streaming page…).
 */
export function toEmbedUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\.|^m\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1);
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:live|shorts|embed)\/([^/?]+)/)?.[1] ?? null;
  }
  if (id) return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&playsinline=1&rel=0`;
  return url.toString();
}

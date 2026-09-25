/**
 * Base URL used in QR codes and share links. On a deployed site this is just the
 * current origin. For LAN testing (the host laptop is on "localhost") set
 * NEXT_PUBLIC_PUBLIC_URL=http://192.168.x.x:3000 so phones can open the link.
 */
export function publicBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_PUBLIC_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return typeof window !== "undefined" ? window.location.origin : "";
}

export const roomUrl = (code: string) => `${publicBaseUrl()}/r/${code}`;

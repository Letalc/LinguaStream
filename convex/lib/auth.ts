import { ConvexError } from "convex/values";

// Minimal auth for a conference setup: production staff and room operators share
// one password (ADMIN_PASSWORD env var in Convex). Viewers need nothing.
export function requireAdmin(key: string): void {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) throw new ConvexError("ADMIN_PASSWORD is not configured in Convex");
  if (key !== expected) throw new ConvexError("Invalid admin password");
}

import { ConvexError } from "convex/values";

export type Role = "admin" | "demo";

/** The key the "Enter as demo" button sends. Only valid when DEMO_MODE=true. */
export const DEMO_KEY = "demo";

/**
 * Minimal auth for a conference setup: production staff and room operators share one
 * password (ADMIN_PASSWORD env var in Convex). Viewers need nothing.
 * With DEMO_MODE=true, the key "demo" grants one-click judge access (it can only delete its own sessions).
 */
export function requireAdmin(key: string): Role {
  const expected = process.env.ADMIN_PASSWORD;
  if (expected && key === expected) return "admin";
  if (key === DEMO_KEY && process.env.DEMO_MODE === "true") return "demo";
  if (!expected) throw new ConvexError("ADMIN_PASSWORD is not configured in Convex");
  throw new ConvexError("Invalid admin password");
}

export function demoEnabled() {
  return process.env.DEMO_MODE === "true";
}

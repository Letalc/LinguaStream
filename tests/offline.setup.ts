import { beforeEach, afterEach, vi } from "vitest";

// A forgotten mock must fail loudly, never consume provider quota or write to a deployment.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network is disabled in offline tests"); }));
  vi.stubGlobal("WebSocket", class {
    constructor() { throw new Error("WebSocket is disabled in offline tests"); }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

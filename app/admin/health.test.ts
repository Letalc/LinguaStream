import { expect, test } from "vitest";
import { formatElapsed } from "@/components/admin/health";

test("formats live, ended, long, and not-started session durations", () => {
  expect(formatElapsed(undefined, undefined, 50_000)).toBe("—");
  expect(formatElapsed(1_000, undefined, 3_501)).toBe("00:00:02");
  expect(formatElapsed(1_000, 3_501, 99_999)).toBe("00:00:02");
  expect(formatElapsed(0, undefined, 27 * 3_600_000 + 4 * 60_000 + 5_000)).toBe("27:04:05");
  expect(formatElapsed(10_000, undefined, 5_000)).toBe("00:00:00");
});

/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");
const key = "offline-test-password";

beforeEach(() => {
  vi.stubEnv("ADMIN_PASSWORD", key);
  vi.stubEnv("DEMO_MODE", "false");
});

async function createRoom(t: ReturnType<typeof convexTest<typeof schema>>, room: number) {
  const sessionId = await t.mutation(api.sessions.create, {
    key, title: `Talk ${room}`, room: `Room ${room}`,
    sourceLang: room % 2 ? "es" : "en", targetLangs: room % 2 ? ["en", "pt"] : ["es", "pt"],
  });
  const owner = { key, sessionId, consoleId: `console-${room}` };
  expect(await t.mutation(api.sessions.claim, { ...owner, force: false })).toEqual({ ok: true });
  await t.mutation(api.sessions.setStatus, { ...owner, status: "live" });
  return owner;
}

test.each([3, 10])("isolates %i simultaneous rooms and all EN/ES/PT feeds", async (roomCount) => {
  const t = convexTest(schema, modules);
  const rooms = await Promise.all(Array.from({ length: roomCount }, (_, i) => createRoom(t, i)));
  // Interleave concurrent writes across rooms and languages using the actual mutations.
  for (let seq = 0; seq < 4; seq++) {
    await Promise.all(rooms.flatMap((room, i) => (["en", "es", "pt"] as const).map(async (lang) => {
      const marker = `room-${i}/${lang}/${seq}`;
      await t.mutation(api.segments.setPartial, { ...room, lang, text: marker });
      await t.mutation(api.segments.commitLine, {
        ...room, lang, text: marker, startMs: seq * 2000, endMs: seq * 2000 + 1600,
        remainingPartial: `next-${i}/${lang}`, latencyMs: 800,
      });
    })));
  }
  for (const [i, room] of rooms.entries()) {
    for (const lang of ["en", "es", "pt"] as const) {
      const feed = await t.query(api.segments.feed, { sessionId: room.sessionId, lang });
      expect(feed.lines.map((line) => line.text)).toEqual(Array.from({ length: 4 }, (_, seq) => `room-${i}/${lang}/${seq}`));
      expect(feed.lines.map((line) => line.seq)).toEqual([0, 1, 2, 3]);
      expect(feed.partial).toBe(`next-${i}/${lang}`);
    }
  }
  const dashboard = await t.query(api.sessions.dashboard, {});
  expect(dashboard).toHaveLength(roomCount);
  for (const room of dashboard) {
    expect(room.stats?.segmentCount).toBe(4);
    expect(room.stats?.avgLatencyMs).toBe(800);
  }
});

test("rejects a wrong admin key and an old console after takeover", async () => {
  const t = convexTest(schema, modules);
  const room = await createRoom(t, 0);
  const line = { ...room, lang: "en" as const, text: "Only the owner can write", startMs: 0, endMs: 1000, remainingPartial: "" };
  await expect(t.mutation(api.segments.commitLine, { ...line, key: "wrong" })).rejects.toThrow("Invalid admin password");
  expect(await t.mutation(api.sessions.claim, { ...room, consoleId: "other", force: false })).toMatchObject({ ok: false });
  expect(await t.mutation(api.sessions.claim, { ...room, consoleId: "other", force: true })).toEqual({ ok: true });
  await expect(t.mutation(api.segments.commitLine, line)).rejects.toThrow("no longer owns");
  await expect(t.mutation(api.segments.setPartial, { ...room, lang: "en", text: "stale" })).rejects.toThrow("no longer owns");
  await expect(t.mutation(api.sessions.heartbeat, room)).rejects.toThrow("no longer owns");
  await expect(t.mutation(api.sessions.setStatus, { ...room, status: "ended" })).rejects.toThrow("no longer owns");
  expect((await t.query(api.segments.feed, { sessionId: room.sessionId, lang: "en" })).lines).toEqual([]);
});

test("partial updates do not rewrite committed lines and ending clears the partial", async () => {
  const t = convexTest(schema, modules);
  const room = await createRoom(t, 0);
  await t.mutation(api.segments.setPartial, { ...room, lang: "en", text: "First partial" });
  await t.mutation(api.segments.commitLine, { ...room, lang: "en", text: "Final original", startMs: 0, endMs: 1000, remainingPartial: "Next" });
  await t.mutation(api.segments.setPartial, { ...room, lang: "en", text: "A replacement partial" });
  const feed = await t.query(api.segments.feed, { sessionId: room.sessionId, lang: "en" });
  expect(feed.lines).toEqual([{ seq: 0, text: "Final original", startMs: 0 }]);
  expect(feed.partial).toBe("A replacement partial");
  await t.mutation(api.sessions.setStatus, { ...room, status: "ended" });
  expect((await t.query(api.segments.feed, { sessionId: room.sessionId, lang: "en" })).partial).toBe("");
  expect(await t.query(api.segments.transcript, { sessionId: room.sessionId, lang: "en" })).toEqual([
    { seq: 0, text: "Final original", startMs: 0, endMs: 1000 },
  ]);
});

test("scopes the Live glossary to the requested room while including global terms", async () => {
  const t = convexTest(schema, modules);
  const [a, b] = await Promise.all([createRoom(t, 0), createRoom(t, 1)]);
  await t.mutation(api.glossary.add, { key, term: "Nerdearla" });
  await t.mutation(api.glossary.add, { key, sessionId: a.sessionId, term: "deployment", translations: { es: "despliegue", pt: "implantação" } });
  await t.mutation(api.glossary.add, { key, sessionId: b.sessionId, term: "PrivateRoomTerm" });
  const glossary = await t.query(internal.glossary.listInternal, { sessionId: a.sessionId });
  expect(glossary.map((g) => g.term)).toEqual(["Nerdearla", "deployment"]);
  expect(glossary[1].translations).toEqual({ es: "despliegue", pt: "implantação" });
});

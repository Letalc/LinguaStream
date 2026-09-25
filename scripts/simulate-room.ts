/**
 * Simulates one or more conference rooms from the command line: each room streams a
 * WAV file (16 kHz, 16-bit, mono) in real time through the same pipeline the browser
 * console uses (Convex token → Gemini Live translate → Convex subtitles).
 *
 * Useful to load-test several simultaneous sessions and to demo without microphones.
 *
 *   CONFIRM_PAID_TEST=YES MAX_TEST_COST_USD=5 ADMIN_PASSWORD=... \
 *     npx tsx scripts/simulate-room.ts talk-en.wav:en:es,pt charla-es.wav:es:en
 *
 * Each argument is  <wav file>:<source lang>:<comma-separated target langs>
 * The preflight refuses to run without an explicit budget and confirmation. Set
 * DRY_RUN=1 to validate files and calculate cost without contacting any service.
 */
import { ConvexHttpClient } from "convex/browser";
import fs from "fs";
import path from "path";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { LiveTranslateStream, SpeechClock, type LineEvents } from "../lib/live-transcriber";

type Lang = "es" | "en" | "pt";
type RoomSpec = { file: string; sourceLang: Lang; targetLangs: Lang[]; pcm: Buffer; durationMs: number };

const PRICE_PER_CONNECTION_MINUTE = Number(process.env.GEMINI_COST_PER_MINUTE_USD ?? "0.0368");
const BUDGET_RESERVE_USD = 0.25;
const DROP_EVERY_SECONDS = Number(process.env.DROP_EVERY_SECONDS ?? "0");
const activeCleanups = new Set<() => Promise<void>>();
let shuttingDown = false;

const KEY = process.env.ADMIN_PASSWORD ?? "";
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? readEnvLocal("NEXT_PUBLIC_CONVEX_URL");

async function simulateRoom(spec: RoomSpec, roomIndex: number) {
  if (!CONVEX_URL) throw new Error("NEXT_PUBLIC_CONVEX_URL is missing");
  const convex = new ConvexHttpClient(CONVEX_URL);
  const { file, sourceLang, targetLangs, pcm, durationMs } = spec;
  const room = `Sala ${roomIndex + 1}`;
  const tag = `[${room}]`;
  const counts: Record<string, number> = Object.fromEntries([sourceLang, ...targetLangs].map((lang) => [lang, 0]));
  let reconnects = 0;
  const writes = new Set<Promise<unknown>>();
  const track = (promise: Promise<unknown>) => {
    writes.add(promise);
    void promise.then(() => writes.delete(promise), () => writes.delete(promise));
  };

  const sessionId: Id<"sessions"> = await convex.mutation(api.sessions.create, {
    key: KEY,
    title: `Simulación: ${path.basename(file)}`,
    room,
    sourceLang,
    targetLangs,
  });
  const consoleId = `sim-${roomIndex}-${Date.now()}`;
  await convex.mutation(api.sessions.claim, { key: KEY, sessionId, consoleId, force: true });
  console.log(`${tag} session ${sessionId}: ${sourceLang} → ${targetLangs.join(", ")}`);

  const events = (lang: Lang): LineEvents => ({
    onPartial: (text, receivedAt) =>
      void convex.mutation(api.segments.setPartial, { key: KEY, sessionId, consoleId, lang, text, receivedAt }).catch(() => {}),
    onCommit: (l) => {
      counts[lang] = (counts[lang] ?? 0) + 1;
      console.log(`${tag} [${lang}] ${l.text}${l.latencyMs !== undefined ? `  (${l.latencyMs} ms)` : ""}`);
      track(convex.mutation(api.segments.commitLine, {
        key: KEY, sessionId, consoleId, lang,
        text: l.text, startMs: l.startMs, endMs: l.endMs, latencyMs: l.latencyMs, remainingPartial: l.remaining,
      }));
    },
  });

  const clock = new SpeechClock();
  const streams = targetLangs.map(
    (target, i) =>
      new LiveTranslateStream({
        clock,
        getToken: () => convex.action(api.gemini.createLiveToken, { key: KEY, sessionId, targetLang: target }),
        input: i === 0 ? events(sourceLang) : undefined,
        output: events(target),
        onStatus: (s, err) => {
          if (err) console.log(`${tag} ${target}: ${s} (${err})`);
          const status = s === "connecting" ? "live" : s === "stopped" ? "ended" : s;
          track(convex.mutation(api.sessions.setStatus, { key: KEY, sessionId, consoleId, status, error: err }));
        },
      }),
  );
  await Promise.all(streams.map((s) => s.start()));
  const heartbeat = setInterval(
    () => void convex.mutation(api.sessions.heartbeat, { key: KEY, sessionId, consoleId }).catch(() => {}),
    5000,
  );
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(heartbeat);
    await Promise.allSettled(streams.map((stream) => stream.stop()));
    await Promise.allSettled([...writes]);
    await convex.mutation(api.sessions.setStatus, { key: KEY, sessionId, consoleId, status: "ended" }).catch(() => null);
  };
  activeCleanups.add(cleanup);

  const silence = Buffer.alloc(3200);
  const CHUNK = 3200; // 100 ms of 16 kHz 16-bit audio
  let sent = 0;
  for (let i = 0; i < pcm.length + CHUNK * 5; i += CHUNK) {
    const chunk = i < pcm.length ? pcm.subarray(i, i + CHUNK) : silence;
    clock.observe(rms(chunk));
    sent++;
    if (DROP_EVERY_SECONDS > 0 && sent % Math.round(DROP_EVERY_SECONDS * 10) === 0) {
      reconnects += streams.length;
      console.log(`${tag} >>> forcing reconnect ${reconnects}`);
      for (const stream of streams) stream.simulateDrop();
    }
    const b64 = chunk.toString("base64");
    for (const stream of streams) stream.pushAudio(b64);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  await cleanup();
  activeCleanups.delete(cleanup);
  console.log(`${tag} done → /s/${sessionId}`);
  return { sessionId, room, file, sourceLang, targetLangs, durationMs, counts, reconnects };
}

function rms(chunk: Buffer) {
  let sum = 0;
  for (let j = 0; j + 1 < chunk.length; j += 2) {
    const v = chunk.readInt16LE(j) / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / Math.max(1, chunk.length / 2));
}

function readEnvLocal(name: string) {
  try {
    const line = fs.readFileSync(".env.local", "utf8").split("\n").find((l) => l.startsWith(name + "="));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
  }
}

const specs = process.argv.slice(2);
if (specs.length === 0) {
  console.error("Usage: npx tsx scripts/simulate-room.ts <file.wav:src:targets> [...more rooms]");
  process.exit(1);
}
const parsed = specs.map(parseSpec);
const connectionMinutes = parsed.reduce((sum, spec) => sum + ((spec.durationMs + 500) / 60_000) * spec.targetLangs.length, 0);
const estimatedCostUsd = connectionMinutes * PRICE_PER_CONNECTION_MINUTE;
const maxCostUsd = Number(process.env.MAX_TEST_COST_USD);

console.log(JSON.stringify({ rooms: parsed.length, connectionMinutes: round(connectionMinutes), estimatedCostUsd: round(estimatedCostUsd), maxCostUsd }, null, 2));
if (process.env.DRY_RUN === "1") process.exit(0);
if (!KEY || !CONVEX_URL) throw new Error("Set ADMIN_PASSWORD and NEXT_PUBLIC_CONVEX_URL before a paid run");
if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) throw new Error("Set MAX_TEST_COST_USD to a positive budget");
if (estimatedCostUsd > maxCostUsd - BUDGET_RESERVE_USD) {
  throw new Error(`Estimated cost $${estimatedCostUsd.toFixed(2)} exceeds the budget after the $${BUDGET_RESERVE_USD.toFixed(2)} reserve`);
}
if (process.env.CONFIRM_PAID_TEST !== "YES") throw new Error("Set CONFIRM_PAID_TEST=YES after reviewing the preflight");

const startedAt = new Date().toISOString();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown(signal));
}
Promise.all(parsed.map(simulateRoom))
  .then((rooms) => {
    const report = { startedAt, finishedAt: new Date().toISOString(), connectionMinutes, estimatedCostUsd, maxCostUsd, rooms };
    if (process.env.TEST_REPORT_PATH) fs.writeFileSync(process.env.TEST_REPORT_PATH, JSON.stringify(report, null, 2));
    setTimeout(() => process.exit(0), 1500);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

async function shutdown(signal: "SIGINT" | "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`Received ${signal}; closing ${activeCleanups.size} active rooms...`);
  await Promise.allSettled([...activeCleanups].map((cleanup) => cleanup()));
  process.exit(signal === "SIGINT" ? 130 : 143);
}

function parseSpec(raw: string): RoomSpec {
  const [file, source = "en", targets = "es"] = raw.split(":");
  if (!isLang(source)) throw new Error(`Invalid source language in ${raw}`);
  const targetLangs = [...new Set(targets.split(",").filter(isLang))];
  if (!targetLangs.length || targetLangs.includes(source)) throw new Error(`Invalid target languages in ${raw}`);
  const { pcm, durationMs } = readPcmWav(file);
  return { file, sourceLang: source, targetLangs, pcm, durationMs };
}

function readPcmWav(file: string) {
  const wav = fs.readFileSync(file);
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error(`${file}: not a WAV file`);
  let offset = 12;
  let validFormat = false;
  let pcm: Buffer | null = null;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt " && size >= 16) {
      validFormat = wav.readUInt16LE(start) === 1 && wav.readUInt16LE(start + 2) === 1 && wav.readUInt32LE(start + 4) === 16_000 && wav.readUInt16LE(start + 14) === 16;
    }
    if (id === "data") pcm = wav.subarray(start, Math.min(start + size, wav.length));
    offset = start + size + (size % 2);
  }
  if (!validFormat || !pcm) throw new Error(`${file}: expected 16 kHz, 16-bit, mono PCM WAV`);
  return { pcm, durationMs: pcm.length / 32 };
}

function isLang(value: string): value is Lang {
  return value === "es" || value === "en" || value === "pt";
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

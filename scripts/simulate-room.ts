/**
 * Simulates one or more conference rooms from the command line: each room streams a
 * WAV file (16 kHz, 16-bit, mono) in real time through the same pipeline the browser
 * console uses (Convex token → Gemini Live translate → Convex subtitles).
 *
 * Useful to load-test several simultaneous sessions and to demo without microphones.
 *
 *   ADMIN_PASSWORD=... npx tsx scripts/simulate-room.ts talk-en.wav:en:es,pt charla-es.wav:es:en
 *
 * Each argument is  <wav file>:<source lang>:<comma-separated target langs>
 * Options (env): LOOP=1 repeats the audio forever, DROP=1 forces a reconnect after 6 s.
 */
import { ConvexHttpClient } from "convex/browser";
import fs from "fs";
import path from "path";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { LiveTranslateStream, SpeechClock, type LineEvents } from "../lib/live-transcriber";

type Lang = "es" | "en" | "pt";

const KEY = process.env.ADMIN_PASSWORD ?? "";
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? readEnvLocal("NEXT_PUBLIC_CONVEX_URL");
if (!KEY || !CONVEX_URL) {
  console.error("Set ADMIN_PASSWORD and NEXT_PUBLIC_CONVEX_URL (or run from the project root with .env.local).");
  process.exit(1);
}
const convex = new ConvexHttpClient(CONVEX_URL);

async function simulateRoom(spec: string, roomIndex: number) {
  const [file, source = "en", targets = "es"] = spec.split(":");
  const sourceLang = source as Lang;
  const targetLangs = targets.split(",").filter(Boolean) as Lang[];
  const room = `Sala ${roomIndex + 1}`;
  const tag = `[${room}]`;

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
    onPartial: (text) =>
      void convex.mutation(api.segments.setPartial, { key: KEY, sessionId, consoleId, lang, text }).catch(() => {}),
    onCommit: (l) => {
      console.log(`${tag} [${lang}] ${l.text}${l.latencyMs !== undefined ? `  (${l.latencyMs} ms)` : ""}`);
      void convex.mutation(api.segments.commitLine, {
        key: KEY, sessionId, consoleId, lang,
        text: l.text, startMs: l.startMs, endMs: l.endMs, latencyMs: l.latencyMs, remainingPartial: l.remaining,
      });
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
          void convex.mutation(api.sessions.setStatus, { key: KEY, sessionId, consoleId, status, error: err });
        },
      }),
  );
  await Promise.all(streams.map((s) => s.start()));
  const heartbeat = setInterval(
    () => void convex.mutation(api.sessions.heartbeat, { key: KEY, sessionId, consoleId }).catch(() => {}),
    5000,
  );

  const pcm = fs.readFileSync(file).subarray(44); // skip the WAV header
  const silence = Buffer.alloc(3200);
  const CHUNK = 3200; // 100 ms of 16 kHz 16-bit audio
  let sent = 0;
  do {
    for (let i = 0; i < pcm.length + CHUNK * 20; i += CHUNK) {
      const chunk = i < pcm.length ? pcm.subarray(i, i + CHUNK) : silence;
      clock.observe(rms(chunk));
      if (process.env.DROP && ++sent === 60) {
        console.log(`${tag} >>> forcing a reconnect`);
        streams[0].simulateDrop();
      }
      const b64 = chunk.toString("base64");
      for (const s of streams) s.pushAudio(b64);
      await new Promise((r) => setTimeout(r, 100));
    }
  } while (process.env.LOOP);

  clearInterval(heartbeat);
  await Promise.all(streams.map((s) => s.stop()));
  console.log(`${tag} done → /s/${sessionId}`);
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
Promise.all(specs.map(simulateRoom))
  .then(() => setTimeout(() => process.exit(0), 1500))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

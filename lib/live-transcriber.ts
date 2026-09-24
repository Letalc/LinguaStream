"use client";

import { GoogleGenAI, type LiveServerMessage, type Session } from "@google/genai";

/**
 * One Gemini Live *translate* connection for one target language.
 *
 * The model streams two text channels at the same time:
 *   - inputTranscription  → what the speaker says (original language)
 *   - outputTranscription → the simultaneous translation
 * Both arrive as small deltas (a few words each). A `LineSegmenter` per channel
 * turns those deltas into subtitle lines (partial + committed).
 *
 * The class also owns the connection lifecycle: session-resumption handles,
 * server GoAway notices and unexpected drops trigger a transparent reconnect,
 * buffering ~5 s of audio meanwhile.
 */

export type LiveTokenResponse = { token: string; model: string; config: Record<string, unknown> };

export type CommittedLine = {
  text: string;
  startMs: number; // relative to console start
  endMs: number;
  latencyMs?: number; // end of speech → line committed (measured after pauses)
  remaining: string; // text already heard that belongs to the next line
};

export type StreamStatus = "connecting" | "live" | "reconnecting" | "stopped" | "error";

export type LineEvents = {
  onPartial: (text: string) => void;
  onCommit: (line: CommittedLine) => void;
};

type Options = {
  getToken: () => Promise<LiveTokenResponse>;
  input?: LineEvents; // original-language lines (only one stream per room needs this)
  output: LineEvents; // translated lines
  onStatus: (status: StreamStatus, error?: string) => void;
  onDebug?: (msg: LiveServerMessage) => void;
  clock: SpeechClock;
};

const MAX_BUFFERED_CHUNKS = 50; // ~5 s of 100 ms audio chunks kept while reconnecting

export class LiveTranslateStream {
  private session: Session | null = null;
  private resumeHandle: string | undefined;
  private stopped = false;
  private reconnecting = false;
  private pending: string[] = [];
  private inSeg: LineSegmenter | null;
  private outSeg: LineSegmenter;

  constructor(private opts: Options) {
    this.inSeg = opts.input ? new LineSegmenter(opts.input, opts.clock) : null;
    this.outSeg = new LineSegmenter(opts.output, opts.clock);
  }

  async start() {
    this.opts.onStatus("connecting");
    await this.connect();
  }

  /** Base64 PCM chunk (16 kHz, 16-bit mono, 100 ms). */
  pushAudio(base64: string) {
    if (this.stopped) return;
    if (!this.session || this.reconnecting) {
      this.pending.push(base64);
      if (this.pending.length > MAX_BUFFERED_CHUNKS) this.pending.shift();
      return;
    }
    this.send(base64);
  }

  async stop() {
    this.stopped = true;
    this.inSeg?.flush("stop");
    this.outSeg.flush("stop");
    try {
      this.session?.close();
    } catch {}
    this.session = null;
    this.opts.onStatus("stopped");
  }

  /** Drops the connection on purpose — used by the console's "simulate drop" demo button. */
  simulateDrop() {
    try {
      this.session?.close();
    } catch {}
  }

  // ---------- connection ----------

  private async connect() {
    const { token, model, config } = await this.opts.getToken();
    const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });

    this.session = await ai.live.connect({
      model,
      config: { ...config, sessionResumption: { handle: this.resumeHandle } },
      callbacks: {
        onmessage: (msg) => this.onMessage(msg),
        onerror: (e) => console.error("[live] error", e),
        onclose: (e) => {
          console.warn("[live] closed", e?.code, e?.reason);
          this.session = null;
          if (!this.stopped) void this.reconnect(e?.reason || `connection closed (${e?.code})`);
        },
      },
    });

    this.reconnecting = false;
    this.opts.onStatus("live");
    const queued = this.pending;
    this.pending = [];
    for (const chunk of queued) this.send(chunk);
  }

  private async reconnect(reason: string) {
    if (this.reconnecting || this.stopped) return;
    this.reconnecting = true;
    this.opts.onStatus("reconnecting", reason);
    let attempt = 0;
    while (!this.stopped) {
      try {
        await this.connect();
        return;
      } catch (e) {
        attempt++;
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[live] reconnect failed", attempt, msg);
        // A stale resumption handle can make every attempt fail: start fresh after 2 tries.
        if (attempt >= 2) this.resumeHandle = undefined;
        this.opts.onStatus("reconnecting", msg);
        await sleep(Math.min(8000, 500 * 2 ** attempt));
      }
    }
  }

  private send(base64: string) {
    try {
      this.session?.sendRealtimeInput({ audio: { data: base64, mimeType: "audio/pcm;rate=16000" } });
    } catch (e) {
      console.error("[live] send failed", e);
    }
  }

  private onMessage(msg: LiveServerMessage) {
    this.opts.onDebug?.(msg);

    const upd = msg.sessionResumptionUpdate;
    if (upd?.resumable && upd.newHandle) this.resumeHandle = upd.newHandle;

    if (msg.goAway) {
      // The server will close soon: reconnect now, resuming with the latest handle.
      try {
        this.session?.close();
      } catch {}
      return;
    }

    const c = msg.serverContent;
    if (!c) return;
    if (c.inputTranscription?.text) this.inSeg?.append(c.inputTranscription.text);
    if (c.outputTranscription?.text) this.outSeg.append(c.outputTranscription.text);
    if (c.turnComplete) {
      this.inSeg?.flush("turn");
      this.outSeg.flush("turn");
    }
  }
}

/**
 * Tracks when the speaker last made sound (from the audio RMS), so we can measure
 * "end of speech → subtitle on screen" latency after each pause.
 */
export class SpeechClock {
  readonly t0 = Date.now();
  lastVoiceAt = 0;
  observe(rms: number) {
    if (rms > 0.015) this.lastVoiceAt = Date.now();
  }
}

// ---------- segmentation ----------

const MIN_WORDS = 3;
const MAX_WORDS = 18; // subtitles read best at ~6-18 words per line
const SILENCE_COMMIT_MS = 1500;

/** Turns a stream of text deltas into subtitle lines. */
export class LineSegmenter {
  private buffer = "";
  private bufferStartedAt = 0;
  private lastTextAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private events: LineEvents,
    private clock: SpeechClock,
  ) {}

  append(delta: string) {
    const now = Date.now();
    if (!this.buffer.trim()) this.bufferStartedAt = now;
    this.buffer = normalize(this.buffer + delta);
    this.lastTextAt = now;
    this.cutLines();
    this.events.onPartial(this.buffer.trim());
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush("silence"), SILENCE_COMMIT_MS);
  }

  flush(reason: "turn" | "silence" | "stop") {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.buffer.trim()) this.commit(this.buffer, "", reason);
  }

  private cutLines() {
    for (;;) {
      const text = this.buffer;
      const end = findSentenceEnd(text);
      if (end > 0 && wordCount(text.slice(0, end)) >= MIN_WORDS) {
        this.commit(text.slice(0, end), text.slice(end), "sentence");
        continue;
      }
      if (wordCount(text) > MAX_WORDS) {
        const cut = findSoftCut(text);
        this.commit(text.slice(0, cut), text.slice(cut), "length");
        continue;
      }
      return;
    }
  }

  private commit(text: string, remaining: string, reason: string) {
    const now = Date.now();
    const clean = text.replace(/\s+/g, " ").trim();
    this.buffer = remaining.trimStart();
    if (!clean) return;
    const { t0, lastVoiceAt } = this.clock;
    // Latency = how long after the speaker stopped talking the last words reached us.
    // Only measurable after a pause (while someone talks, "end of speech" is unknown).
    const paused = reason !== "sentence" && reason !== "length";
    const lag = this.lastTextAt - lastVoiceAt;
    const latencyMs = paused && lastVoiceAt > 0 && lag >= 0 && lag < 10_000 ? lag : undefined;
    this.events.onCommit({
      text: clean,
      startMs: Math.max(0, this.bufferStartedAt - t0 - 1500), // text trails the voice by ~1.5 s
      endMs: Math.max(0, this.lastTextAt - t0),
      latencyMs,
      remaining: this.buffer.trim(),
    });
    this.bufferStartedAt = now;
  }
}

// ---------- helpers ----------

/** Fix spacing glitches like "Nerdearla.Today" coming from concatenated deltas. */
function normalize(s: string) {
  return s.replace(/([.!?…])(?=[A-ZÁÉÍÓÚÑ¿¡])/g, "$1 ").replace(/\s{2,}/g, " ");
}

function wordCount(s: string) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function findSentenceEnd(text: string): number {
  const m = /[.!?…](?=\s)/.exec(text);
  return m ? m.index + 1 : -1;
}

/** Cut an over-long line at the last comma/semicolon, else at MAX_WORDS - 4 words. */
function findSoftCut(text: string): number {
  const parts = text.split(/(\s+)/);
  let pos = 0;
  let count = 0;
  let lastComma = -1;
  for (const w of parts) {
    pos += w.length;
    if (!w.trim()) continue;
    count++;
    if (/[,;:]$/.test(w) && count >= MIN_WORDS) lastComma = pos;
    if (count >= MAX_WORDS - 4 && lastComma < 0) return pos;
    if (count >= MAX_WORDS) break;
  }
  return lastComma > 0 ? lastComma : pos;
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

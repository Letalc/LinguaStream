"use client";

import { GoogleGenAI, type LiveServerMessage, type Session } from "@google/genai";

/**
 * Streams PCM audio to the Gemini Live API and turns the incremental input
 * transcription into subtitle lines:
 *  - `onPartial(text)`   → the line currently being spoken (changes constantly)
 *  - `onCommit(line)`    → a finished line (sentence end, long pause, or too long)
 *
 * Handles the Live API's connection lifecycle: session resumption handles,
 * server GoAway notices and unexpected drops all trigger a transparent reconnect.
 */

export type LiveTokenResponse = { token: string; model: string; config: Record<string, unknown> };

export type CommittedLine = {
  text: string;
  startMs: number; // relative to transcriber start
  endMs: number;
  latencyMs?: number; // end of speech → committed (only measurable after a pause)
  remaining: string; // text already heard that belongs to the next line
};

export type TranscriberStatus = "connecting" | "live" | "reconnecting" | "stopped" | "error";

type Callbacks = {
  getToken: () => Promise<LiveTokenResponse>;
  onPartial: (text: string) => void;
  onCommit: (line: CommittedLine) => void;
  onStatus: (status: TranscriberStatus, error?: string) => void;
  onDebug?: (msg: LiveServerMessage) => void;
};

// Segmentation tuning (subtitles read best at ~6-18 words per line).
const MIN_WORDS = 3;
const MAX_WORDS = 20;
const SILENCE_COMMIT_MS = 1200;
const MAX_BUFFERED_CHUNKS = 50; // ~5 s of audio kept while reconnecting
const VOICE_RMS = 0.015; // rough voice-activity threshold for latency measurement

export class LiveTranscriber {
  private session: Session | null = null;
  private resumeHandle: string | undefined;
  private stopped = false;
  private reconnecting = false;
  private pending: string[] = []; // base64 audio chunks waiting for a connection

  private buffer = ""; // uncommitted transcription text
  private bufferStartedAt = 0;
  private lastTextAt = 0;
  private lastVoiceAt = 0;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly t0 = Date.now();

  constructor(private cb: Callbacks) {}

  async start() {
    this.cb.onStatus("connecting");
    await this.connect();
  }

  /** Called by the audio pipeline for every 100 ms PCM chunk. */
  pushAudio(pcm: ArrayBuffer, rms: number) {
    if (this.stopped) return;
    if (rms > VOICE_RMS) this.lastVoiceAt = Date.now();
    const data = arrayBufferToBase64(pcm);
    if (!this.session || this.reconnecting) {
      this.pending.push(data);
      if (this.pending.length > MAX_BUFFERED_CHUNKS) this.pending.shift();
      return;
    }
    this.send(data);
  }

  async stop() {
    this.stopped = true;
    this.flush("stop");
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    try {
      this.session?.close();
    } catch {}
    this.session = null;
    this.cb.onStatus("stopped");
  }

  /** Forces a reconnect — used by the console's "simulate drop" button for demos. */
  simulateDrop() {
    try {
      this.session?.close();
    } catch {}
  }

  // ---------- connection ----------

  private async connect() {
    const { token, model, config } = await this.cb.getToken();
    const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });

    const sessionConfig = {
      ...config,
      sessionResumption: { handle: this.resumeHandle },
    };

    this.session = await ai.live.connect({
      model,
      config: sessionConfig,
      callbacks: {
        onopen: () => {},
        onmessage: (msg) => this.onMessage(msg),
        onerror: (e) => {
          console.error("[live] error", e);
        },
        onclose: (e) => {
          console.warn("[live] closed", e?.code, e?.reason);
          this.session = null;
          if (!this.stopped) void this.reconnect(e?.reason || `closed (${e?.code})`);
        },
      },
    });

    this.reconnecting = false;
    this.cb.onStatus("live");
    // Flush audio captured while we were offline.
    const queued = this.pending;
    this.pending = [];
    for (const chunk of queued) this.send(chunk);
  }

  private async reconnect(reason: string) {
    if (this.reconnecting || this.stopped) return;
    this.reconnecting = true;
    this.cb.onStatus("reconnecting", reason);
    let attempt = 0;
    while (!this.stopped) {
      try {
        await this.connect();
        return;
      } catch (e) {
        attempt++;
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[live] reconnect failed", attempt, msg);
        // A stale resumption handle can make every attempt fail: drop it after 2 tries.
        if (attempt >= 2) this.resumeHandle = undefined;
        this.cb.onStatus("reconnecting", msg);
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

  // ---------- server messages ----------

  private onMessage(msg: LiveServerMessage) {
    this.cb.onDebug?.(msg);

    if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) {
      this.resumeHandle = msg.sessionResumptionUpdate.newHandle;
    }
    if (msg.goAway) {
      // The server will close soon: reconnect proactively with the resume handle.
      try {
        this.session?.close();
      } catch {}
      return;
    }

    const content = msg.serverContent;
    if (!content) return;

    const piece = content.inputTranscription?.text;
    if (piece) this.appendText(piece);
    if (content.inputTranscription?.finished || content.turnComplete) this.flush("turn");
  }

  // ---------- segmentation ----------

  private appendText(piece: string) {
    const now = Date.now();
    if (!this.buffer.trim()) this.bufferStartedAt = now;
    this.buffer += piece;
    this.lastTextAt = now;
    this.cutLines();
    this.cb.onPartial(this.buffer.trim());

    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => this.flush("silence"), SILENCE_COMMIT_MS);
  }

  /** Commit complete sentences (or over-long runs) while the speaker keeps talking. */
  private cutLines() {
    for (;;) {
      const text = this.buffer;
      const sentenceEnd = findSentenceEnd(text);
      if (sentenceEnd > 0 && wordCount(text.slice(0, sentenceEnd)) >= MIN_WORDS) {
        this.commit(text.slice(0, sentenceEnd), text.slice(sentenceEnd), "sentence");
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

  private flush(reason: "turn" | "silence" | "stop") {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.buffer.trim()) this.commit(this.buffer, "", reason);
  }

  private commit(text: string, remaining: string, reason: string) {
    const now = Date.now();
    const clean = text.replace(/\s+/g, " ").trim();
    this.buffer = remaining;
    if (!clean) return;
    // After a pause we know when the voice stopped, so latency is measurable.
    const paused = reason === "turn" || reason === "silence" || reason === "stop";
    const latencyMs =
      paused && this.lastVoiceAt > 0 && now - this.lastVoiceAt < 10_000
        ? Math.max(0, now - this.lastVoiceAt - (reason === "silence" ? SILENCE_COMMIT_MS : 0))
        : undefined;
    this.cb.onCommit({
      text: clean,
      startMs: Math.max(0, this.bufferStartedAt - this.t0 - 1500),
      endMs: Math.max(0, this.lastTextAt - this.t0),
      latencyMs,
      remaining: remaining.trim(),
    });
    this.bufferStartedAt = now;
  }
}

// ---------- helpers ----------

function wordCount(s: string) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Index right after the first sentence terminator followed by whitespace (or end). */
function findSentenceEnd(text: string): number {
  const m = /[.!?…](?=\s)/.exec(text);
  return m ? m.index + 1 : -1;
}

/** Cut an over-long line at the last comma/semicolon, else after MAX_WORDS-4 words. */
function findSoftCut(text: string): number {
  const words = text.split(/(\s+)/);
  let pos = 0;
  let lastComma = -1;
  let count = 0;
  for (const w of words) {
    pos += w.length;
    if (w.trim()) {
      count++;
      if (/[,;:]$/.test(w) && count >= MIN_WORDS) lastComma = pos;
      if (count >= MAX_WORDS - 4 && lastComma < 0) return pos;
      if (count >= MAX_WORDS) break;
    }
  }
  return lastComma > 0 ? lastComma : pos;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

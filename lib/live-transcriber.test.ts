import { beforeEach, expect, test, vi } from "vitest";
import type { LiveServerMessage } from "@google/genai";
import { LineSegmenter, LiveTranslateStream, SpeechClock, type CommittedLine } from "./live-transcriber";

type Callbacks = {
  onmessage: (message: any) => void;
  onclose: (event: { code: number; reason: string }) => void;
};
const sdk = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class { live = { connect: sdk.connect }; },
}));

function connection(callbacks: Callbacks) {
  return {
    callbacks,
    sendRealtimeInput: vi.fn(),
    close: vi.fn(() => callbacks.onclose({ code: 1000, reason: "test disconnect" })),
  };
}
type Connection = ReturnType<typeof connection>;
const connections: Connection[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  connections.length = 0;
  sdk.connect.mockReset().mockImplementation(async ({ callbacks }: { callbacks: Callbacks }) => {
    const result = connection(callbacks);
    connections.push(result);
    return result;
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function createStream() {
  const originals: CommittedLine[] = [];
  const translations: CommittedLine[] = [];
  const status = vi.fn();
  const getToken = vi.fn(async () => ({ token: "offline-token", model: "mock", config: {} }));
  const clock = new SpeechClock();
  const stream = new LiveTranslateStream({
    clock, getToken, onStatus: status,
    input: { onPartial: vi.fn(), onCommit: (line) => originals.push(line) },
    output: { onPartial: vi.fn(), onCommit: (line) => translations.push(line) },
  });
  return { stream, originals, translations, status, getToken, clock };
}

test("runs 10 streams for 30 simulated minutes, preserving each room across reconnects", async () => {
  const rooms = Array.from({ length: 10 }, createStream);
  await Promise.all(rooms.map((room) => room.stream.start()));
  const latestConnection = (i: number) => connections.filter((_, n) => n % 10 === i).at(-1)!;
  // Actual class lifecycle, mocked SDK transport and virtual time: not provider/load/latency certification.
  for (let second = 0; second < 1800; second++) {
    if (second > 0 && second % 300 === 0) {
      for (const [i, room] of rooms.entries()) {
        latestConnection(i).callbacks.onmessage({ sessionResumptionUpdate: { resumable: true, newHandle: `resume-${i}-${second}` } });
        room.stream.simulateDrop();
      }
      await vi.advanceTimersByTimeAsync(0);
    }
    for (const [i, room] of rooms.entries()) {
      room.clock.observe(0.1);
      room.stream.pushAudio(`audio-${i}-${second}`);
      latestConnection(i).callbacks.onmessage({ serverContent: {
        inputTranscription: { text: `original room-${i} second-${second}` },
        outputTranscription: { text: `translation room-${i} second-${second}` }, turnComplete: true,
      } });
    }
    await vi.advanceTimersByTimeAsync(1000);
  }
  const stopped = Promise.all(rooms.map((room) => room.stream.stop()));
  await vi.advanceTimersByTimeAsync(2500);
  await stopped;
  for (const [i, room] of rooms.entries()) {
    expect(room.originals).toHaveLength(1800);
    expect(room.translations).toHaveLength(1800);
    expect(room.translations.every((line, second) => line.text === `translation room-${i} second-${second}`)).toBe(true);
    expect(room.originals.every((line, second) => line.text === `original room-${i} second-${second}`)).toBe(true);
    expect(room.getToken).toHaveBeenCalledTimes(6);
    expect(room.status).toHaveBeenLastCalledWith("stopped");
    for (let round = 1; round < 6; round++) {
      expect(sdk.connect.mock.calls[round * 10 + i][0].config.sessionResumption.handle).toBe(`resume-${i}-${round * 300}`);
    }
  }
  expect(connections.every((c) => c.close.mock.calls.length === 1)).toBe(true);
});

test("keeps only the newest five seconds of audio during a dropped connection", async () => {
  const { stream, getToken } = createStream();
  await stream.start();
  let resolveToken!: (token: { token: string; model: string; config: object }) => void;
  getToken.mockImplementationOnce(() => new Promise((resolve) => { resolveToken = resolve; }));
  stream.simulateDrop();
  for (let i = 0; i < 70; i++) stream.pushAudio(`chunk-${i}`);
  resolveToken({ token: "offline-reconnect", model: "mock", config: {} });
  await vi.advanceTimersByTimeAsync(0);
  expect(connections[1].sendRealtimeInput.mock.calls.map(([input]) => input.audio.data)).toEqual(
    Array.from({ length: 50 }, (_, i) => `chunk-${i + 20}`),
  );
});

test("does not reopen when stopped while fetching a reconnect token", async () => {
  const { stream, getToken, status } = createStream();
  await stream.start();
  let resolveToken!: (token: { token: string; model: string; config: object }) => void;
  getToken.mockImplementationOnce(() => new Promise((resolve) => { resolveToken = resolve; }));
  stream.simulateDrop();
  await stream.stop();
  resolveToken({ token: "late-token", model: "mock", config: {} });
  await vi.advanceTimersByTimeAsync(0);
  expect(sdk.connect).toHaveBeenCalledTimes(1);
  expect(status).toHaveBeenLastCalledWith("stopped");
});

test("ignores delayed close and message callbacks from a replaced socket", async () => {
  const { stream, translations, getToken } = createStream();
  await stream.start();
  const old = connections[0];
  stream.simulateDrop();
  await vi.advanceTimersByTimeAsync(0);
  old.callbacks.onclose({ code: 1006, reason: "late close" });
  old.callbacks.onmessage({ serverContent: { outputTranscription: { text: "stale text" }, turnComplete: true } });
  await vi.advanceTimersByTimeAsync(0);
  expect(getToken).toHaveBeenCalledTimes(2);
  expect(translations).toEqual([]);
  stream.pushAudio("current");
  expect(connections[1].sendRealtimeInput).toHaveBeenLastCalledWith({ audio: { data: "current", mimeType: "audio/pcm;rate=16000" } });
});

test("retries a failed reconnect, then clears an invalid resume handle", async () => {
  const { stream, status } = createStream();
  await stream.start();
  connections[0].callbacks.onmessage({ sessionResumptionUpdate: { resumable: true, newHandle: "stale" } });
  sdk.connect.mockRejectedValueOnce(new Error("expired handle")).mockRejectedValueOnce(new Error("expired handle"));
  stream.simulateDrop();
  await vi.advanceTimersByTimeAsync(3500);
  expect(sdk.connect).toHaveBeenCalledTimes(4);
  expect(sdk.connect.mock.calls[3][0].config.sessionResumption.handle).toBeUndefined();
  expect(status).toHaveBeenLastCalledWith("live");
});

test("flushes Unicode source/translation text after silence and measures observed arrival lag", () => {
  const clock = new SpeechClock();
  const committed = vi.fn();
  const partial = vi.fn();
  const segmenter = new LineSegmenter({ onCommit: committed, onPartial: partial }, clock);
  clock.observe(0.2);
  vi.advanceTimersByTime(800);
  segmenter.append("Olá Nerdearla, implantação em português");
  vi.advanceTimersByTime(1800);
  segmenter.tick(Date.now());
  expect(committed).toHaveBeenCalledExactlyOnceWith({
    text: "Olá Nerdearla, implantação em português", startMs: 0, endMs: 800,
    latencyMs: 800, remaining: "",
  });
  expect(partial).toHaveBeenCalled();
});

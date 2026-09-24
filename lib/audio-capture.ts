"use client";

export type AudioSource = { kind: "mic"; deviceId?: string } | { kind: "tab" };

/**
 * Captures audio from a microphone / mixer input, or from a browser tab
 * (handy for demos and for rooms whose audio is already on a stream),
 * and emits 16 kHz 16-bit PCM chunks of 100 ms.
 */
export async function startCapture(
  source: AudioSource,
  onChunk: (pcm: ArrayBuffer, rms: number) => void,
): Promise<{ stop: () => void; label: string }> {
  let stream: MediaStream;
  if (source.kind === "mic") {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: source.deviceId ? { exact: source.deviceId } : undefined,
        channelCount: 1,
        // A conference mixer feed is already clean: don't let the browser "fix" it.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      },
    });
  } else {
    // Chrome requires video to be requested to share tab audio; we drop the video track.
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    stream.getVideoTracks().forEach((t) => t.stop());
    if (stream.getAudioTracks().length === 0) {
      throw new Error('No audio track: tick "Share tab audio" when choosing the tab.');
    }
  }

  // Asking the context for 16 kHz makes the browser resample for us.
  const ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule("/pcm-worklet.js");
  const input = ctx.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(ctx, "pcm-worklet");
  worklet.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) =>
    onChunk(e.data.pcm, e.data.rms);
  input.connect(worklet);
  // The worklet must be connected to a destination to be pulled; a muted gain keeps it silent.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  worklet.connect(mute).connect(ctx.destination);

  const label = stream.getAudioTracks()[0]?.label ?? "audio";
  return {
    label,
    stop: () => {
      worklet.port.onmessage = null;
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}

export async function listInputDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "audioinput");
}

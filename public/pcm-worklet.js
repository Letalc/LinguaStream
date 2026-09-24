// AudioWorklet: runs on the audio thread. Converts the float samples of a 16 kHz
// AudioContext into 16-bit PCM chunks of 100 ms, the format the Gemini Live API expects.
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkSize = 1600; // 100 ms at 16 kHz
    this.buffer = new Int16Array(this.chunkSize);
    this.offset = 0;
    this.sumSquares = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      this.sumSquares += s * s;
      this.buffer[this.offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.offset === this.chunkSize) {
        const rms = Math.sqrt(this.sumSquares / this.chunkSize);
        this.port.postMessage({ pcm: this.buffer.buffer, rms }, [this.buffer.buffer]);
        this.buffer = new Int16Array(this.chunkSize);
        this.offset = 0;
        this.sumSquares = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-worklet", PcmWorklet);

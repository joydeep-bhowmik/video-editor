import type { WaveformPeaks } from "../types";
import { throwIfAborted } from "./cancel";

// ~50 peaks/sec gives a genuinely detailed, spiky waveform instead of a smoothed blob;
// capped so a multi-hour import doesn't allocate an unbounded array.
const PEAKS_PER_SECOND = 50;
const MIN_PEAKS = 400;
const MAX_PEAKS = 20_000;

const EMPTY: WaveformPeaks = { min: [], max: [] };

/** Per-source waveform min/max envelope, evenly spaced across the full source duration. */
export async function extractWaveform(file: File, signal?: AbortSignal): Promise<WaveformPeaks> {
  try {
    throwIfAborted(signal);
    const arrayBuffer = await file.arrayBuffer();
    throwIfAborted(signal);
    const ctx = new AudioContext();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    throwIfAborted(signal);
    const channel = audioBuffer.getChannelData(0);

    const peakCount = Math.min(
      MAX_PEAKS,
      Math.max(MIN_PEAKS, Math.round(audioBuffer.duration * PEAKS_PER_SECOND))
    );
    const samplesPerPeak = Math.max(1, Math.floor(channel.length / peakCount));

    const min: number[] = new Array(peakCount);
    const max: number[] = new Array(peakCount);
    for (let i = 0; i < peakCount; i++) {
      const start = i * samplesPerPeak;
      let lo = 0;
      let hi = 0;
      for (let j = 0; j < samplesPerPeak; j++) {
        const v = channel[start + j] ?? 0;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      min[i] = lo;
      max[i] = hi;
    }

    await ctx.close();
    return { min, max };
  } catch (e) {
    // A cancel must propagate; only genuine decode failures degrade to "no waveform".
    if (e instanceof Error && e.name === "CancelledError") throw e;
    console.error("waveform extraction failed", e);
    return { ...EMPTY };
  }
}

/** Slice a source's full-duration peaks down to the portion a trimmed clip actually uses. */
export function sliceWaveform(
  peaks: WaveformPeaks,
  sourceDuration: number,
  inPoint: number,
  outPoint: number
): WaveformPeaks {
  if (peaks.max.length === 0 || sourceDuration <= 0) return EMPTY;
  const startIdx = Math.max(0, Math.floor((inPoint / sourceDuration) * peaks.max.length));
  const endIdx = Math.min(peaks.max.length, Math.ceil((outPoint / sourceDuration) * peaks.max.length));
  if (endIdx <= startIdx) return EMPTY;
  return { min: peaks.min.slice(startIdx, endIdx), max: peaks.max.slice(startIdx, endIdx) };
}

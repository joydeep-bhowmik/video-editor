import type { WaveformPeaks } from "../types";

interface WaveformProps {
  peaks: WaveformPeaks;
  className: string;
}

const VIEW_H = 100;
const MID = VIEW_H / 2;
const MIN_AMP = 1;

export function Waveform({ peaks, className }: WaveformProps) {
  const { min, max } = peaks;
  if (max.length === 0) return null;

  let top = "";
  for (let i = 0; i < max.length; i++) {
    const amp = Math.max(MIN_AMP, max[i] * MID);
    top += `L${i},${(MID - amp).toFixed(2)} `;
  }
  let bottom = "";
  for (let i = min.length - 1; i >= 0; i--) {
    const amp = Math.max(MIN_AMP, Math.abs(min[i]) * MID);
    bottom += `L${i},${(MID + amp).toFixed(2)} `;
  }
  const d = `M0,${MID} ${top}${bottom}Z`;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${max.length} ${VIEW_H}`}
      preserveAspectRatio="none"
    >
      <path d={d} />
    </svg>
  );
}

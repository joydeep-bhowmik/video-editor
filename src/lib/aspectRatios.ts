export interface AspectRatioPreset {
  id: string;
  platform: string;
  label: string;
  ratioLabel: string;
  width: number;
  height: number;
}

export const CUSTOM_ASPECT_RATIO_ID = "custom";

export const ASPECT_RATIO_GROUPS: { platform: string; icon: string; presets: AspectRatioPreset[] }[] = [
  {
    platform: "Instagram",
    icon: "ri-instagram-line",
    presets: [
      { id: "ig-1-1", platform: "Instagram", label: "Feed square", ratioLabel: "1:1", width: 1080, height: 1080 },
      { id: "ig-4-5", platform: "Instagram", label: "Feed portrait", ratioLabel: "4:5", width: 1080, height: 1350 },
      { id: "ig-9-16", platform: "Instagram", label: "Reels & Story", ratioLabel: "9:16", width: 1080, height: 1920 },
    ],
  },
  {
    platform: "X (Twitter)",
    icon: "ri-twitter-x-line",
    presets: [
      { id: "x-16-9", platform: "X (Twitter)", label: "Landscape", ratioLabel: "16:9", width: 1280, height: 720 },
      { id: "x-1-1", platform: "X (Twitter)", label: "Square", ratioLabel: "1:1", width: 1080, height: 1080 },
    ],
  },
  {
    platform: "YouTube",
    icon: "ri-youtube-line",
    presets: [
      { id: "yt-16-9", platform: "YouTube", label: "Standard", ratioLabel: "16:9", width: 1920, height: 1080 },
      { id: "yt-9-16", platform: "YouTube", label: "Shorts", ratioLabel: "9:16", width: 1080, height: 1920 },
    ],
  },
  {
    platform: "Facebook",
    icon: "ri-facebook-line",
    presets: [
      { id: "fb-16-9", platform: "Facebook", label: "Landscape", ratioLabel: "16:9", width: 1280, height: 720 },
      { id: "fb-1-1", platform: "Facebook", label: "Square", ratioLabel: "1:1", width: 1080, height: 1080 },
      { id: "fb-4-5", platform: "Facebook", label: "Portrait", ratioLabel: "4:5", width: 1080, height: 1350 },
      { id: "fb-9-16", platform: "Facebook", label: "Story & Reel", ratioLabel: "9:16", width: 1080, height: 1920 },
    ],
  },
  {
    platform: "TikTok",
    icon: "ri-tiktok-line",
    presets: [{ id: "tt-9-16", platform: "TikTok", label: "Vertical", ratioLabel: "9:16", width: 1080, height: 1920 }],
  },
  {
    platform: "LinkedIn",
    icon: "ri-linkedin-line",
    presets: [
      { id: "li-16-9", platform: "LinkedIn", label: "Landscape", ratioLabel: "16:9", width: 1280, height: 720 },
      { id: "li-1-1", platform: "LinkedIn", label: "Square", ratioLabel: "1:1", width: 1080, height: 1080 },
    ],
  },
];

const ALL_PRESETS = ASPECT_RATIO_GROUPS.flatMap((g) => g.presets);

export function findPresetById(id: string): AspectRatioPreset | undefined {
  return ALL_PRESETS.find((p) => p.id === id);
}

/** Matches a canvas size back to a known preset (for highlighting the active tile); "custom" otherwise. */
export function matchPreset(width: number, height: number): string {
  return ALL_PRESETS.find((p) => p.width === width && p.height === height)?.id ?? CUSTOM_ASPECT_RATIO_ID;
}

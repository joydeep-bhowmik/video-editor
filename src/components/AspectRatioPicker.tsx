import { useEffect, useState } from "react";
import { ASPECT_RATIO_GROUPS, CUSTOM_ASPECT_RATIO_ID, matchPreset } from "../lib/aspectRatios";

interface AspectRatioPickerProps {
  width: number;
  height: number;
  onSelect: (width: number, height: number, presetId: string) => void;
}

export function AspectRatioPicker({ width, height, onSelect }: AspectRatioPickerProps) {
  const activeId = matchPreset(width, height);
  const [customW, setCustomW] = useState(width);
  const [customH, setCustomH] = useState(height);

  // Keep the custom fields in sync when the canvas size changes via a preset tile elsewhere.
  useEffect(() => {
    setCustomW(width);
    setCustomH(height);
  }, [width, height]);

  function commitCustom(w: number, h: number) {
    const cw = Math.max(16, Math.min(7680, Math.round(w) || width));
    const ch = Math.max(16, Math.min(7680, Math.round(h) || height));
    setCustomW(cw);
    setCustomH(ch);
    onSelect(cw, ch, CUSTOM_ASPECT_RATIO_ID);
  }

  return (
    <div className="ar-picker">
      {ASPECT_RATIO_GROUPS.map((group) => (
        <div className="ar-group" key={group.platform}>
          <div className="transition-category-title">
            <i className={group.icon} aria-hidden="true" />
            <span>{group.platform}</span>
          </div>
          <div className="effect-grid">
            {group.presets.map((preset) => (
              <button
                type="button"
                key={preset.id}
                className={"effect-tile ar-tile" + (activeId === preset.id ? " is-applied" : "")}
                onClick={() => onSelect(preset.width, preset.height, preset.id)}
                data-tip={`${preset.label} — ${preset.width}×${preset.height}`}
              >
                <span
                  className="ar-swatch"
                  style={{ aspectRatio: `${preset.width} / ${preset.height}` }}
                />
                <span>{preset.ratioLabel}</span>
                <span className="ar-tile-label">{preset.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="ar-group">
        <div className="transition-category-title">
          <i className="ri-crop-line" aria-hidden="true" />
          <span>Custom</span>
        </div>
        <div className={"ar-custom" + (activeId === CUSTOM_ASPECT_RATIO_ID ? " is-active" : "")}>
          <label className="ar-custom-field">
            <span>Width</span>
            <input
              type="number"
              value={customW}
              min={16}
              max={7680}
              onChange={(e) => setCustomW(Number(e.target.value))}
              onBlur={() => commitCustom(customW, customH)}
            />
          </label>
          <span className="ar-custom-x">×</span>
          <label className="ar-custom-field">
            <span>Height</span>
            <input
              type="number"
              value={customH}
              min={16}
              max={7680}
              onChange={(e) => setCustomH(Number(e.target.value))}
              onBlur={() => commitCustom(customW, customH)}
            />
          </label>
        </div>
      </div>
    </div>
  );
}

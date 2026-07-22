import { EFFECT_BY_KIND, EFFECT_CATALOG, type EffectExtraKey } from "../lib/effects";
import type { Clip, EffectKind } from "../types";

interface EffectsPanelProps {
  clip: Clip | undefined;
  onAdd: (kind: EffectKind) => void;
  onRemove: (effectId: string) => void;
  onIntensity: (effectId: string, intensity: number) => void;
  onExtra: (effectId: string, key: EffectExtraKey, value: number) => void;
  onBeginEdit: () => void;
  onEndEdit: () => void;
}

export function EffectsPanel({
  clip,
  onAdd,
  onRemove,
  onIntensity,
  onExtra,
  onBeginEdit,
  onEndEdit,
}: EffectsPanelProps) {
  if (!clip) {
    return (
      <div className="panel-empty">
        Tap a clip on the timeline first, then add effects to it here.
      </div>
    );
  }

  const applied = clip.effects;
  const appliedKinds = new Set(applied.map((e) => e.kind));

  return (
    <div className="effects-body">
      {applied.length > 0 && (
        <div className="effect-applied">
          {applied.map((effect) => {
            const def = EFFECT_BY_KIND.get(effect.kind);
            return (
              <div className="effect-card" key={effect.id}>
                <div className="effect-card-head">
                  <i className={def?.icon ?? "ri-sparkling-line"} aria-hidden="true" />
                  <span className="effect-card-name">{def?.label ?? effect.kind}</span>
                  <button
                    type="button"
                    className="effect-remove"
                    onClick={() => onRemove(effect.id)}
                    data-tip="Remove this effect"
                    aria-label={`Remove ${def?.label ?? effect.kind}`}
                  >
                    <i className="ri-close-line" aria-hidden="true" />
                  </button>
                </div>
                <label className="effect-slider-row">
                  <span>{def?.amountLabel ?? "Amount"}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(effect.intensity * 100)}
                    onPointerDown={onBeginEdit}
                    onPointerUp={onEndEdit}
                    onChange={(e) => onIntensity(effect.id, Number(e.target.value) / 100)}
                  />
                  <span className="effect-value">{Math.round(effect.intensity * 100)}%</span>
                </label>

                {def?.extras?.map((extra) => {
                  const value = effect[extra.key] ?? extra.default;
                  return (
                    <label className="effect-slider-row" key={extra.key}>
                      <span>{extra.label}</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(value * 100)}
                        onPointerDown={onBeginEdit}
                        onPointerUp={onEndEdit}
                        onChange={(e) => onExtra(effect.id, extra.key, Number(e.target.value) / 100)}
                      />
                      <span className="effect-value">{Math.round(value * 100)}%</span>
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      <div className="effect-picker-title">Add an effect</div>
      <div className="effect-grid">
        {EFFECT_CATALOG.map((def) => {
          const already = appliedKinds.has(def.kind);
          return (
            <button
              type="button"
              key={def.kind}
              className={"effect-tile" + (already ? " is-applied" : "")}
              disabled={already}
              onClick={() => onAdd(def.kind)}
              data-tip={already ? `${def.label} is already applied` : `${def.label} — ${def.hint}`}
            >
              <i className={def.icon} aria-hidden="true" />
              <span>{def.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { DEFAULT_TRANSFORM_BASE } from "../lib/constants";
import type { Clip, Transform } from "../types";

interface TransformPanelProps {
  clip: Clip | undefined;
  onChange: (t: Transform) => void;
  onBeginEdit: () => void;
  onEndEdit: () => void;
}

/** One numeric field, editable by slider drag or exact typing, showing an integer in `unit`. */
interface FieldSpec {
  key: keyof Transform;
  label: string;
  min: number;
  max: number;
  unit: string;
  /** Multiply the stored value by this to display it (e.g. fraction → %). */
  toDisplay: number;
}

const POSITION: FieldSpec[] = [
  { key: "x", label: "X", min: -100, max: 100, unit: "%", toDisplay: 100 },
  { key: "y", label: "Y", min: -100, max: 100, unit: "%", toDisplay: 100 },
];
const ANCHOR: FieldSpec[] = [
  { key: "anchorX", label: "X", min: 0, max: 100, unit: "%", toDisplay: 100 },
  { key: "anchorY", label: "Y", min: 0, max: 100, unit: "%", toDisplay: 100 },
];
const CROP: FieldSpec[] = [
  { key: "cropTop", label: "Top", min: 0, max: 100, unit: "%", toDisplay: 100 },
  { key: "cropRight", label: "Right", min: 0, max: 100, unit: "%", toDisplay: 100 },
  { key: "cropBottom", label: "Bottom", min: 0, max: 100, unit: "%", toDisplay: 100 },
  { key: "cropLeft", label: "Left", min: 0, max: 100, unit: "%", toDisplay: 100 },
];
const SKEW: FieldSpec[] = [
  { key: "skewX", label: "X", min: -60, max: 60, unit: "°", toDisplay: 1 },
  { key: "skewY", label: "Y", min: -60, max: 60, unit: "°", toDisplay: 1 },
];

export function TransformPanel({ clip, onChange, onBeginEdit, onEndEdit }: TransformPanelProps) {
  if (!clip) {
    return (
      <div className="panel-empty">
        Tap a clip on the timeline first, then adjust its position, scale and more here.
      </div>
    );
  }

  const t = clip.transform;

  // Discrete edit (typing, toggling): a self-contained begin→change→end so it's one undo step.
  function commit(partial: Partial<Transform>) {
    onBeginEdit();
    onChange({ ...t, ...partial });
    onEndEdit();
  }

  function Field({ spec }: { spec: FieldSpec }) {
    const raw = t[spec.key] as number;
    const shown = Math.round(raw * spec.toDisplay);
    return (
      <label className="xform-field">
        <span className="xform-field-label">{spec.label}</span>
        <input
          type="range"
          min={spec.min}
          max={spec.max}
          value={shown}
          onPointerDown={onBeginEdit}
          onPointerUp={onEndEdit}
          onChange={(e) => onChange({ ...t, [spec.key]: Number(e.target.value) / spec.toDisplay })}
        />
        <input
          type="number"
          className="xform-num"
          value={shown}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isNaN(v)) commit({ [spec.key]: v / spec.toDisplay } as Partial<Transform>);
          }}
        />
        <span className="xform-unit">{spec.unit}</span>
      </label>
    );
  }

  function Section({ icon, title, fields }: { icon: string; title: string; fields: FieldSpec[] }) {
    return (
      <div className="xform-section">
        <div className="transition-category-title">
          <i className={icon} aria-hidden="true" />
          <span>{title}</span>
        </div>
        {fields.map((f) => (
          <Field spec={f} key={f.key} />
        ))}
      </div>
    );
  }

  return (
    <div className="effects-body xform-body">
      <Section icon="ri-drag-move-2-line" title="Position" fields={POSITION} />

      <div className="xform-section">
        <div className="transition-category-title">
          <i className="ri-aspect-ratio-line" aria-hidden="true" />
          <span>Scale &amp; Rotation</span>
        </div>
        <Field spec={{ key: "scale", label: "Scale", min: 1, max: 300, unit: "%", toDisplay: 100 }} />
        <Field spec={{ key: "rotation", label: "Rotate", min: -180, max: 180, unit: "°", toDisplay: 1 }} />
      </div>

      <Section icon="ri-focus-3-line" title="Anchor Point" fields={ANCHOR} />

      <div className="xform-section">
        <div className="transition-category-title">
          <i className="ri-contrast-drop-line" aria-hidden="true" />
          <span>Opacity</span>
        </div>
        <Field spec={{ key: "opacity", label: "Opacity", min: 0, max: 100, unit: "%", toDisplay: 100 }} />
      </div>

      <Section icon="ri-crop-line" title="Crop" fields={CROP} />

      <div className="xform-section">
        <div className="transition-category-title">
          <i className="ri-flip-horizontal-line" aria-hidden="true" />
          <span>Flip</span>
        </div>
        <div className="xform-toggles">
          <button
            type="button"
            className={"xform-toggle" + (t.flipH ? " is-on" : "")}
            onClick={() => commit({ flipH: !t.flipH })}
          >
            <i className="ri-flip-horizontal-line" aria-hidden="true" /> Horizontal
          </button>
          <button
            type="button"
            className={"xform-toggle" + (t.flipV ? " is-on" : "")}
            onClick={() => commit({ flipV: !t.flipV })}
          >
            <i className="ri-flip-vertical-line" aria-hidden="true" /> Vertical
          </button>
        </div>
      </div>

      <Section icon="ri-shape-line" title="Skew" fields={SKEW} />

      <div className="xform-section">
        <div className="transition-category-title">
          <i className="ri-box-3-line" aria-hidden="true" />
          <span>Perspective</span>
        </div>
        <Field spec={{ key: "perspective", label: "Tilt", min: -100, max: 100, unit: "", toDisplay: 100 }} />
      </div>

      <button
        type="button"
        className="xform-reset"
        onClick={() =>
          // Keep where the clip lives on screen; reset only the look, matching a base clip.
          commit({ ...DEFAULT_TRANSFORM_BASE, x: t.x, y: t.y })
        }
      >
        <i className="ri-refresh-line" aria-hidden="true" /> Reset transform
      </button>
    </div>
  );
}

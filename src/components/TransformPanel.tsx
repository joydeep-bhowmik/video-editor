import { useRef, useState } from "react";
import { DEFAULT_TRANSFORM_BASE } from "../lib/constants";
import { clipDuration } from "../lib/timeline";
import { keyframeAt, propHasKeyframes, valueAt, type AnimatableProp } from "../lib/keyframes";
import type { Clip, Transform } from "../types";

interface TransformPanelProps {
  clip: Clip | undefined;
  playhead: number;
  onChange: (t: Transform) => void;
  onSetKeyframe: (prop: AnimatableProp, value: number) => void;
  onToggleKeyframe: (prop: AnimatableProp) => void;
  onSeekKeyframe: (dir: -1 | 1) => void;
  onClearKeyframes: () => void;
  onBeginEdit: () => void;
  onEndEdit: () => void;
}

interface FieldSpec {
  key: AnimatableProp;
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

interface FieldProps {
  spec: FieldSpec;
  clip: Clip;
  t: Transform;
  localTime: number;
  onChange: (t: Transform) => void;
  onSetKeyframe: (prop: AnimatableProp, value: number) => void;
  onToggleKeyframe: (prop: AnimatableProp) => void;
  onBeginEdit: () => void;
  onEndEdit: () => void;
}

// Module-level (not defined inside TransformPanel's render): if this were redeclared on every
// parent render, React would see a new component type each time and remount the <input> mid-drag,
// wiping the rAF-throttle state below and detaching the browser's native pointer capture — which
// is exactly what made the slider feel laggy and land on the wrong value.
function Field({ spec, clip, t, localTime, onChange, onSetKeyframe, onToggleKeyframe, onBeginEdit, onEndEdit }: FieldProps) {
  const isAnimated = propHasKeyframes(clip, spec.key);
  const value = valueAt(clip, spec.key, localTime);
  const kfHere = !!keyframeAt(clip, spec.key, localTime);

  // Dragging fires far more native `input` events than the app can usefully re-render/redraw
  // for — queuing a full state update (and canvas redraw) on every one backs up the event loop
  // and the slider feels laggy. Track the drag's live value locally for instant visual feedback,
  // and coalesce the actual onChange to at most once per animation frame.
  const [liveShown, setLiveShown] = useState<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const latestRaw = useRef(0);
  const shown = liveShown ?? Math.round(value * spec.toDisplay);

  // While a prop is animated, edits write a keyframe at the playhead; otherwise they set the
  // static base value (the pre-animation behaviour).
  const setRaw = (raw: number, discrete: boolean) => {
    if (isAnimated) {
      if (discrete) onBeginEdit();
      onSetKeyframe(spec.key, raw);
      if (discrete) onEndEdit();
    } else if (discrete) {
      onBeginEdit();
      onChange({ ...t, [spec.key]: raw });
      onEndEdit();
    } else {
      onChange({ ...t, [spec.key]: raw });
    }
  };

  const onSlide = (raw: number, displayValue: number) => {
    latestRaw.current = raw;
    setLiveShown(displayValue);
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setRaw(latestRaw.current, false);
    });
  };

  const flushSlide = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setRaw(latestRaw.current, false);
    }
    setLiveShown(null);
    onEndEdit();
  };

  return (
    <label className={"xform-field" + (isAnimated ? " is-animated" : "")}>
      <button
        type="button"
        className={"kf-toggle" + (kfHere ? " is-here" : isAnimated ? " is-animated" : "")}
        onClick={() => onToggleKeyframe(spec.key)}
        data-tip={
          kfHere
            ? "Remove keyframe here"
            : isAnimated
              ? "Add a keyframe at the playhead"
              : "Animate this — adds the first keyframe"
        }
        aria-label="Toggle keyframe"
      >
        <span className="kf-diamond" />
      </button>
      <span className="xform-field-label">{spec.label}</span>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        value={shown}
        onPointerDown={onBeginEdit}
        onPointerUp={flushSlide}
        onChange={(e) => onSlide(Number(e.target.value) / spec.toDisplay, Number(e.target.value))}
      />
      <input
        type="number"
        className="xform-num"
        value={shown}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) setRaw(v / spec.toDisplay, true);
        }}
      />
      <span className="xform-unit">{spec.unit}</span>
    </label>
  );
}

interface SectionProps {
  icon: string;
  title: string;
  fields: FieldSpec[];
  clip: Clip;
  t: Transform;
  localTime: number;
  onChange: (t: Transform) => void;
  onSetKeyframe: (prop: AnimatableProp, value: number) => void;
  onToggleKeyframe: (prop: AnimatableProp) => void;
  onBeginEdit: () => void;
  onEndEdit: () => void;
}

function Section({ icon, title, fields, ...fieldProps }: SectionProps) {
  return (
    <div className="xform-section">
      <div className="transition-category-title">
        <i className={icon} aria-hidden="true" />
        <span>{title}</span>
      </div>
      {fields.map((f) => (
        <Field spec={f} key={f.key} {...fieldProps} />
      ))}
    </div>
  );
}

export function TransformPanel({
  clip,
  playhead,
  onChange,
  onSetKeyframe,
  onToggleKeyframe,
  onSeekKeyframe,
  onClearKeyframes,
  onBeginEdit,
  onEndEdit,
}: TransformPanelProps) {
  if (!clip) {
    return (
      <div className="panel-empty">
        Tap a clip on the timeline first, then adjust its position, scale and more here.
      </div>
    );
  }

  const t = clip.transform;
  const dur = clipDuration(clip);
  const localTime = Math.max(0, Math.min(dur, playhead - clip.start));
  const animated = clip.keyframes.length > 0;

  function commit(partial: Partial<Transform>) {
    onBeginEdit();
    onChange({ ...t, ...partial });
    onEndEdit();
  }

  const fieldProps = { clip, t, localTime, onChange, onSetKeyframe, onToggleKeyframe, onBeginEdit, onEndEdit };

  return (
    <div className="effects-body xform-body">
      {animated ? (
        <div className="kf-bar">
          <button
            type="button"
            className="kf-nav"
            onClick={() => onSeekKeyframe(-1)}
            data-tip="Previous keyframe"
            aria-label="Previous keyframe"
          >
            <i className="ri-skip-back-mini-line" aria-hidden="true" />
          </button>
          <span className="kf-bar-label">
            <span className="kf-diamond is-here" /> {localTime.toFixed(2)}s
          </span>
          <button
            type="button"
            className="kf-nav"
            onClick={() => onSeekKeyframe(1)}
            data-tip="Next keyframe"
            aria-label="Next keyframe"
          >
            <i className="ri-skip-forward-mini-line" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="kf-clear"
            onClick={onClearKeyframes}
            data-tip="Remove all keyframes"
            aria-label="Clear animation"
          >
            <i className="ri-delete-bin-line" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="kf-hint">
          <span className="kf-diamond" /> Tap a <strong>◆</strong> to start animating: set a value,
          move the playhead, change it again.
        </div>
      )}

      <Section icon="ri-drag-move-2-line" title="Position" fields={POSITION} {...fieldProps} />

      <div className="xform-section">
        <div className="transition-category-title">
          <i className="ri-aspect-ratio-line" aria-hidden="true" />
          <span>Scale &amp; Rotation</span>
        </div>
        <Field spec={{ key: "scale", label: "Scale", min: 1, max: 300, unit: "%", toDisplay: 100 }} {...fieldProps} />
        <Field spec={{ key: "rotation", label: "Rotate", min: -180, max: 180, unit: "°", toDisplay: 1 }} {...fieldProps} />
      </div>

      <Section icon="ri-focus-3-line" title="Anchor Point" fields={ANCHOR} {...fieldProps} />

      <div className="xform-section">
        <div className="transition-category-title">
          <i className="ri-contrast-drop-line" aria-hidden="true" />
          <span>Opacity</span>
        </div>
        <Field spec={{ key: "opacity", label: "Opacity", min: 0, max: 100, unit: "%", toDisplay: 100 }} {...fieldProps} />
      </div>

      <Section icon="ri-crop-line" title="Crop" fields={CROP} {...fieldProps} />

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

      <Section icon="ri-shape-line" title="Skew" fields={SKEW} {...fieldProps} />

      <div className="xform-section">
        <div className="transition-category-title">
          <i className="ri-box-3-line" aria-hidden="true" />
          <span>Perspective</span>
        </div>
        <Field spec={{ key: "perspective", label: "Tilt", min: -100, max: 100, unit: "", toDisplay: 100 }} {...fieldProps} />
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

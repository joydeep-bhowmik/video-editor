import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Transform } from "../types";

interface TransformGizmoProps {
  transform: Transform;
  onChange: (t: Transform) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

type Drag =
  | { kind: "move"; startX: number; startY: number; originX: number; originY: number }
  | {
      kind: "resize";
      centerX: number;
      centerY: number;
      startDist: number;
      startAngle: number;
      originScale: number;
      originRotation: number;
    };

const ROTATE_STEP = 90;

function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function TransformGizmo({ transform, onChange, onDragStart, onDragEnd }: TransformGizmoProps) {
  // Outer wrapper: positioned/sized in % of the canvas, never itself rotated, so the
  // rotate-shortcut toolbar stays upright no matter what the clip's rotation is.
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const transformRef = useRef(transform);
  transformRef.current = transform;

  function getParentRect() {
    return wrapRef.current?.parentElement?.getBoundingClientRect();
  }

  function handleBodyPointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    onDragStart();
    dragRef.current = {
      kind: "move",
      startX: e.clientX,
      startY: e.clientY,
      originX: transform.x,
      originY: transform.y,
    };
  }

  function handleCornerPointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    const rect = getParentRect();
    if (!rect) return;
    onDragStart();
    const centerX = rect.left + rect.width / 2 + transform.x * rect.width;
    const centerY = rect.top + rect.height / 2 + transform.y * rect.height;
    dragRef.current = {
      kind: "resize",
      centerX,
      centerY,
      startDist: Math.hypot(e.clientX - centerX, e.clientY - centerY) || 1,
      startAngle: Math.atan2(e.clientY - centerY, e.clientX - centerX),
      originScale: transform.scale,
      originRotation: transform.rotation,
    };
  }

  // The rotate buttons/input are single discrete actions, not drags — wrap each in its own
  // begin/end pair so it still lands as exactly one undo step instead of being silently
  // dropped (updateLive alone never touches history without a matching begin/end).
  function rotateBy(delta: number) {
    onDragStart();
    onChange({ ...transform, rotation: normalizeAngle(transform.rotation + delta) });
    onDragEnd();
  }

  const [rotationInput, setRotationInput] = useState(String(Math.round(transform.rotation)));
  useEffect(() => {
    setRotationInput(String(Math.round(transform.rotation)));
  }, [transform.rotation]);

  function commitRotationInput() {
    const parsed = parseFloat(rotationInput);
    if (!Number.isNaN(parsed)) {
      onDragStart();
      onChange({ ...transform, rotation: normalizeAngle(parsed) });
      onDragEnd();
    } else {
      setRotationInput(String(Math.round(transform.rotation)));
    }
  }

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const rect = getParentRect();
      if (!rect) return;

      if (drag.kind === "move") {
        const dx = (e.clientX - drag.startX) / rect.width;
        const dy = (e.clientY - drag.startY) / rect.height;
        onChange({ ...transformRef.current, x: drag.originX + dx, y: drag.originY + dy });
      } else {
        const dx = e.clientX - drag.centerX;
        const dy = e.clientY - drag.centerY;
        const dist = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        const scale = Math.max(0.05, drag.originScale * (dist / drag.startDist));
        const rotation = drag.originRotation + ((angle - drag.startAngle) * 180) / Math.PI;
        onChange({ ...transformRef.current, scale, rotation });
      }
    }
    function onUp() {
      if (dragRef.current) onDragEnd();
      dragRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange]);

  const wrapStyle: CSSProperties = {
    left: `${(0.5 + transform.x - transform.scale / 2) * 100}%`,
    top: `${(0.5 + transform.y - transform.scale / 2) * 100}%`,
    width: `${transform.scale * 100}%`,
    height: `${transform.scale * 100}%`,
  };

  return (
    <div className="gizmo" style={wrapStyle} ref={wrapRef}>
      <div className="gizmo-toolbar" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" title={`Rotate ${ROTATE_STEP}° left`} onClick={() => rotateBy(-ROTATE_STEP)}>
          ⟲
        </button>
        <input
          className="gizmo-rotation-input"
          type="number"
          value={rotationInput}
          onChange={(e) => setRotationInput(e.target.value)}
          onBlur={commitRotationInput}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitRotationInput();
              e.currentTarget.blur();
            }
          }}
          title="Exact rotation in degrees"
        />
        <span className="gizmo-rotation-unit">°</span>
        <button type="button" title={`Rotate ${ROTATE_STEP}° right`} onClick={() => rotateBy(ROTATE_STEP)}>
          ⟳
        </button>
      </div>
      <div className="gizmo-box" style={{ transform: `rotate(${transform.rotation}deg)` }}>
        <div className="gizmo-body" onPointerDown={handleBodyPointerDown} />
        <div className="gizmo-corner" onPointerDown={handleCornerPointerDown} />
      </div>
    </div>
  );
}

import type { CadPoint } from '@wbcnc/cad';
import type { PointerEvent, Ref } from 'react';
import { CadValueInput } from './CadValueInput';
export function SketchSlotControls({
  width,
  onWidth,
  chain,
  onChain,
  error,
  onApply,
  onCancel,
  inputRef,
}: {
  width: string;
  onWidth: (value: string) => void;
  chain: boolean;
  onChain: (value: boolean) => void;
  error?: string;
  onApply: () => void;
  onCancel: () => void;
  inputRef: Ref<HTMLInputElement>;
}) {
  return (
    <form
      aria-label="Slot"
      className="cad-create-size cad-slot-editor"
      onSubmit={e => {
        e.preventDefault();
        onApply();
      }}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}>
      <label>
        Diameter <CadValueInput aria-label="Slot width" inputRef={inputRef} value={width} onChange={e => onWidth(e.target.value)} />
      </label>
      <label>
        <input type="checkbox" aria-label="Select connected slot path" checked={chain} onChange={e => onChain(e.target.checked)} />
        Connected path
      </label>
      <button type="submit" disabled={!!error}>
        Create slot
      </button>
      <button type="button" onClick={onCancel}>
        Cancel slot
      </button>
      {error && (
        <span role="alert" className="cad-error">
          {error}
        </span>
      )}
    </form>
  );
}
export function SketchSlotWidthHandle({
  center,
  radius,
  pixelScale,
  onStart,
}: {
  center: CadPoint;
  radius: number;
  pixelScale: number;
  onStart: (event: PointerEvent<SVGElement>) => void;
}) {
  return (
    <circle
      data-slot-width-handle="true"
      cx={center.x + radius}
      cy={-center.y}
      r={6 / pixelScale}
      fill="#fff"
      stroke="#2467d1"
      strokeWidth={1.5 / pixelScale}
      style={{ cursor: 'ew-resize' }}
      onPointerDown={e => {
        e.preventDefault();
        e.stopPropagation();
        onStart(e);
      }}>
      <title>Drag slot diameter</title>
    </circle>
  );
}

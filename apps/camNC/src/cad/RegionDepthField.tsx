import type { CadCutDepth } from '@wbcnc/cad';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

/** Sets how deep one region is cut. Every choice applies at once, and Escape leaves it as it was. */
export function RegionDepthField({
  style,
  depth,
  thickness,
  onChoose,
  onClose,
}: {
  style?: CSSProperties;
  depth: CadCutDepth;
  thickness: number;
  onChoose: (depth: CadCutDepth) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(String(depth === 'through' ? thickness : depth));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const value = Number(text),
    valid = text.trim() !== '' && Number.isFinite(value) && value >= 0;
  return (
    <div className="cad-region-depth" style={style} role="group" aria-label="Cut depth">
      <input
        ref={input}
        aria-label="Depth in mm"
        aria-invalid={!valid}
        inputMode="decimal"
        value={text}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === 'Escape') onClose();
          if (event.key === 'Enter' && valid) onChoose(value >= thickness ? 'through' : value);
        }}
      />
      <span className="cad-muted">mm</span>
      <button type="button" onClick={() => onChoose('through')}>
        Through
      </button>
      <button type="button" onClick={() => onChoose(0)}>
        No cut
      </button>
    </div>
  );
}

import { useDesignUnits } from './designUnits';
import type { CadCutDepth, CadValueScope } from '@wbcnc/cad';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

/** Sets how deep one region is cut. Every choice applies at once, and Escape leaves it as it was. */
export function RegionDepthField({
  style,
  depth,
  expression,
  thickness,
  variables,
  onChoose,
  onClose,
}: {
  style?: CSSProperties;
  depth: CadCutDepth;
  /** The depth as typed, shown in place of the number. */
  expression?: string;
  thickness: number;
  /** Design variables the depth may use. */
  variables?: CadValueScope;
  /** The depth, and the text typed for it when that uses design variables. */
  onChoose: (depth: CadCutDepth, expression?: string) => void;
  onClose: () => void;
}) {
  const { parseCadValue, lengthText, lengthUnit } = useDesignUnits();
  const [text, setText] = useState(expression ?? lengthText(depth === 'through' ? thickness : depth));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const parsed = parseCadValue(text, { unit: 'mm', variables }),
    valid = 'value' in parsed && parsed.value >= 0,
    value = 'value' in parsed ? parsed.value : NaN;
  return (
    <div className="cad-region-depth" style={style} role="group" aria-label="Cut depth">
      <input
        ref={input}
        aria-label={`Depth in ${lengthUnit}`}
        aria-invalid={!valid}
        title={'error' in parsed ? parsed.error : undefined}
        spellCheck={false}
        value={text}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === 'Escape') onClose();
          if (event.key === 'Enter' && valid)
            onChoose(value >= thickness ? 'through' : value, 'value' in parsed ? parsed.expression : undefined);
        }}
      />
      <span className="cad-muted">{lengthUnit}</span>
      <button type="button" onClick={() => onChoose('through')}>
        Through
      </button>
      <button type="button" onClick={() => onChoose(0)}>
        No cut
      </button>
    </div>
  );
}

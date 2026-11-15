import type { CadPart, CadThinWall, CadValueScope } from '@wbcnc/cad';
import { useState } from 'react';
import { CadValueInput } from './CadValueInput';
import { useDesignUnits } from './designUnits';

/** A thin extrude's walls: centred or not, and how far out and in from the picked shape's outline they reach. */
export function ThinWallFields({
  wall,
  variables,
  onChange,
}: {
  wall: CadThinWall;
  variables?: CadValueScope;
  onChange: (change: (part: CadPart) => CadPart) => void;
}) {
  const { parseCadValue, lengthText, lengthUnit } = useDesignUnits();
  const [texts, setTexts] = useState({
    thickness1: wall.thickness1Expression ?? lengthText(wall.thickness1),
    thickness2: wall.thickness2Expression ?? lengthText(wall.thickness2),
  });
  const [error, setError] = useState<string | null>(null);
  const take = (key: 'thickness1' | 'thickness2', text: string) => {
    setTexts(previous => ({ ...previous, [key]: text }));
    const parsed = parseCadValue(text, { unit: 'mm', variables });
    if ('error' in parsed) return setError(parsed.error);
    const other = key === 'thickness1' ? wall.thickness2 : wall.thickness1;
    if (parsed.value < 0 || parsed.value + other <= 0) return setError('A thin wall needs some thickness.');
    setError(null);
    onChange(part => {
      const next: CadThinWall = { ...part.thinWall!, [key]: parsed.value };
      if (parsed.expression) next[`${key}Expression`] = parsed.expression;
      else delete next[`${key}Expression`];
      return { ...part, thinWall: next };
    });
  };
  const field = (key: 'thickness1' | 'thickness2', label: string) => (
    <label className="cad-number-field">
      {label}
      <span>
        <CadValueInput
          bare
          aria-label={label}
          value={texts[key]}
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          onChange={event => take(key, event.target.value)}
        />
      </span>
      {lengthUnit}
    </label>
  );
  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={!!wall.midPlane}
          onChange={event =>
            onChange(part => {
              const next = { ...part.thinWall! };
              if (event.target.checked) next.midPlane = true;
              else delete next.midPlane;
              return { ...part, thinWall: next };
            })
          }
        />
        Mid plane
      </label>
      {field('thickness1', 'Thickness 1')}
      {/* Centred, the one thickness reaches both ways. */}
      {!wall.midPlane && field('thickness2', 'Thickness 2')}
      {error && (
        <p role="alert" className="cad-thickness-error">
          {error}
        </p>
      )}
    </>
  );
}

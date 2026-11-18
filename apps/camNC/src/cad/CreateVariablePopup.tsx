import { useState } from 'react';
import { createPortal } from 'react-dom';

const kUnsupported = 'Not available yet';
export type VariableKind = 'length' | 'angle' | 'number' | 'any';
const kinds: { kind: VariableKind; label: string }[] = [
  { kind: 'length', label: 'Length' },
  { kind: 'angle', label: 'Angle' },
  { kind: 'number', label: 'Number' },
  { kind: 'any', label: 'Any' },
];

/**
 * The Create variable popup a value field's "New variable" opens, as the reference's: the variable's type, its name
 * from what was typed after `#`, its value from what the field held, and a description. The check makes it and puts
 * `#name` in the field; the cross, or Escape, leaves the field as it was.
 */
export function CreateVariablePopup({
  at,
  name: givenName,
  value: givenValue,
  kind: givenKind,
  problem,
  onCreate,
  onCancel,
}: {
  at: { left: number; top: number };
  name: string;
  value: string;
  kind: VariableKind;
  problem: string | null;
  onCreate: (variable: { name: string; value: string; kind: VariableKind; description: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(givenName);
  const [value, setValue] = useState(givenValue);
  const [kind, setKind] = useState(givenKind);
  const [description, setDescription] = useState('');
  const create = () => onCreate({ name: name.trim(), value: value.trim(), kind, description });
  return createPortal(
    <div
      role="dialog"
      aria-label="Create variable"
      className="cad-create-variable"
      // Kept inside the window, as a field near its edge would push it off.
      style={{
        left: Math.max(4, Math.min(at.left, window.innerWidth - 260)),
        top: Math.max(4, Math.min(at.top, window.innerHeight - 280)),
      }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          create();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}>
      <header>
        <strong>Create variable</strong>
        <span>
          <button type="button" aria-label="Create" className="cad-create-variable-ok" onClick={create}>
            ✓
          </button>
          <button type="button" aria-label="Cancel" className="cad-create-variable-cancel" onClick={onCancel}>
            ✕
          </button>
        </span>
      </header>
      <div role="tablist" aria-label="Variable scope" className="cad-feature-tabs">
        <button type="button" role="tab" aria-selected>
          Feature
        </button>
        <button type="button" role="tab" aria-selected={false} disabled title={kUnsupported}>
          Configuration
        </button>
      </div>
      <div role="tablist" aria-label="Variable type" className="cad-feature-tabs">
        {kinds.map(entry => (
          <button key={entry.kind} type="button" role="tab" aria-selected={kind === entry.kind} onClick={() => setKind(entry.kind)}>
            {entry.label}
          </button>
        ))}
      </div>
      <label>
        Name
        <input aria-label="Name" value={name} autoFocus onChange={event => setName(event.target.value)} />
      </label>
      <label>
        Value
        <input aria-label="Value" value={value} onChange={event => setValue(event.target.value)} />
      </label>
      <label>
        Description
        <input aria-label="Description" value={description} onChange={event => setDescription(event.target.value)} />
      </label>
      {problem && (
        <span role="alert" className="cad-variable-field-problem">
          {problem}
        </span>
      )}
    </div>,
    document.body
  );
}

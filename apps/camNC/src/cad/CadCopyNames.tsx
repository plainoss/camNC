import { cadCopyNumber, type CadPart } from '@wbcnc/cad';
import './cadThicknessField.css';

/** A name for each of a part's copies, which CAM labels its pieces with. An empty name gives back the numbered one. */
export function CadCopyNames({ part, onRename }: { part: CadPart; onRename: (copyId: string, name: string) => void }) {
  if (!part.copies?.length) return null;
  return (
    <details className="cad-copy-names">
      <summary>Names of the {part.copies.length + 1} pieces</summary>
      {part.copies.map((copy, index) => (
        <input
          // A new name typed elsewhere, or undone, starts the box afresh.
          key={`${copy.id}:${copy.name ?? ''}`}
          defaultValue={copy.name ?? ''}
          // The numbered name it gets back when its own is cleared.
          placeholder={`${part.name} ${cadCopyNumber(part, index)}`}
          aria-label={`Name of copy ${cadCopyNumber(part, index)}`}
          spellCheck={false}
          onBlur={event => {
            if (event.target.value.trim() !== (copy.name ?? '')) onRename(copy.id, event.target.value);
          }}
          onKeyDown={event => {
            event.stopPropagation();
            if (event.key === 'Enter') event.currentTarget.blur();
            else if (event.key === 'Escape') {
              event.currentTarget.value = copy.name ?? '';
              event.currentTarget.blur();
            }
          }}
        />
      ))}
    </details>
  );
}

import { useEffect, useState, type RefObject } from 'react';
import { Input } from '@wbcnc/ui/components/input';
import { FileUp } from 'lucide-react';
import { LetteringFontPicker } from './LetteringFontPicker';
import type { CarvingArt } from './carving';

export function CarvingArtFields({
  art,
  onArt,
  onReplace,
  flush,
}: {
  art: CarvingArt;
  onArt: (art: CarvingArt) => void;
  onReplace: () => void;
  /** Set while typed text waits for its debounce: commits it at once. */
  flush: RefObject<(() => void) | null>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? (art.kind === 'text' ? art.text : '');
  // Only typed drafts debounce. Undo can remount against the old SVG before the restored text arrives;
  // treating the old SVG's empty text as a draft would overwrite restored lettering and clear Redo.
  useEffect(() => {
    if (art.kind !== 'text' || draft === null || text === art.text) return;
    const commit = () => {
      clearTimeout(t);
      flush.current = null;
      setDraft(null);
      onArt({ ...art, text });
    };
    const t = setTimeout(commit, 300);
    flush.current = commit;
    return () => {
      clearTimeout(t);
      if (flush.current === commit) flush.current = null;
    };
  }, [text, draft, art, onArt, flush]);
  return art.kind === 'text' ? (
    <>
      <Input
        id="carve-text"
        aria-label="Text"
        value={text}
        maxLength={60}
        className="h-7 w-36 px-2 text-xs"
        onChange={e => setDraft(e.target.value)}
      />
      <div className="w-40">
        <LetteringFontPicker font={art.font} className="h-7 px-2 text-xs" onChange={font => onArt({ ...art, text, font })} />
      </div>
    </>
  ) : (
    <button
      type="button"
      aria-label="Replace SVG"
      title="Replace SVG"
      onClick={onReplace}
      className="flex size-7 items-center justify-center rounded-md hover:bg-muted">
      <FileUp className="size-4" />
    </button>
  );
}

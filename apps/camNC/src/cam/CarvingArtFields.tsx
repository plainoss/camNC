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
  const [text, setText] = useState(art.kind === 'text' ? art.text : '');
  // Typing outlines again once it pauses.
  useEffect(() => {
    if (art.kind !== 'text' || text === art.text) return;
    const commit = () => {
      clearTimeout(t);
      flush.current = null;
      onArt({ ...art, text });
    };
    const t = setTimeout(commit, 300);
    flush.current = commit;
    return () => {
      clearTimeout(t);
      if (flush.current === commit) flush.current = null;
    };
  }, [text, art, onArt, flush]);
  return art.kind === 'text' ? (
    <>
      <Input
        id="carve-text"
        aria-label="Text"
        value={text}
        maxLength={60}
        className="h-7 w-36 px-2 text-xs"
        onChange={e => setText(e.target.value)}
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

import { useEffect, useRef, useState, type RefObject } from 'react';
import { isWebFont, kCarvingFonts, type CarvingArt, type CarvingItemV1 } from './carving';
import { webFontCss } from './webFonts';

/**
 * Types straight onto the board, in the item's own font and size, where its lettering is: Enter or a click elsewhere keeps
 * the text, Escape goes back to it as it was.
 */
export function CarvingInlineText({
  item,
  text: art,
  at,
  flush,
  onText,
  onDone,
}: {
  item: CarvingItemV1;
  text: Extract<CarvingArt, { kind: 'text' }>;
  /** The item's place on the board, as an SVG transform. */
  at: string;
  flush: RefObject<(() => void) | null>;
  onText: (text: string) => void;
  onDone: () => void;
}) {
  const [text, setText] = useState(art.text);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    flush.current = null;
    if (keep && text.trim() && text !== art.text) onText(text);
    onDone();
  };
  // Another selection or a drag commits what's typed, as the bar's Text field does.
  useEffect(() => {
    if (text === art.text) return;
    const commit = () => finish(true);
    flush.current = commit;
    return () => {
      if (flush.current === commit) flush.current = null;
    };
  });
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const m = inkMetrics(art.font, text || 'M');
  // Sized so the ink is the item's height, as it will be outlined; centred on the item, as the outline is.
  const size = (100 * item.height) / m.inkH;
  const k = size / 100;
  const line = (m.fontA + m.fontD) * k * 1.1;
  const baseline = (line - (m.fontA + m.fontD) * k) / 2 + m.fontA * k;
  const inkMid = baseline - ((m.inkA - m.inkD) / 2) * k;
  // Hugging the text as it grows, with room for the caret.
  const width = Math.max(m.advance * k, item.height) + item.height / 2;
  const dx = (m.advance / 2 - (m.inkR - m.inkL) / 2) * k;
  return (
    <g transform={at}>
      <foreignObject x={-width / 2 + dx} y={-inkMid} width={width} height={line} className="overflow-visible">
        <input
          ref={input}
          aria-label="Text on the board"
          value={text}
          maxLength={60}
          spellCheck={false}
          onChange={e => setText(e.target.value)}
          onPointerDown={e => e.stopPropagation()}
          onBlur={() => finish(true)}
          onKeyDown={e => {
            if (e.key === 'Enter') finish(true);
            else if (e.key === 'Escape') {
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
              finish(false);
            }
          }}
          className="block h-full w-full border-0 bg-transparent p-0 text-center text-amber-800 caret-primary outline-none dark:text-amber-500"
          style={{ font: fontCss(art.font, size), lineHeight: `${line}px`, outline: `${item.height / 60}px dashed var(--primary)` }}
        />
      </foreignObject>
    </g>
  );
}

const fontCss = (font: Extract<CarvingArt, { kind: 'text' }>['font'], size: number) =>
  isWebFont(font) ? `${font.weight} ${size}px ${webFontCss(font)}` : kCarvingFonts[font].css.replace('{size}', String(size));

/** The text's metrics at 100 px, as `outlineArt` measures it. */
function inkMetrics(font: Extract<CarvingArt, { kind: 'text' }>['font'], text: string) {
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = fontCss(font, 100);
  const m = ctx.measureText(text);
  const inkA = m.actualBoundingBoxAscent,
    inkD = m.actualBoundingBoxDescent;
  return {
    inkA,
    inkD,
    inkH: Math.max(inkA + inkD, 1),
    inkL: m.actualBoundingBoxLeft,
    inkR: m.actualBoundingBoxRight,
    advance: m.width,
    fontA: m.fontBoundingBoxAscent,
    fontD: m.fontBoundingBoxDescent,
  };
}

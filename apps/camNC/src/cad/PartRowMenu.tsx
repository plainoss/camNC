import { useEffect, useLayoutEffect, useRef } from 'react';
import './featureList.css';

/** A row's right-click menu, such as a part's in the Parts list or a base plane's, styled and keyed as the feature list's. */
export function PartRowMenu({
  name,
  x,
  y,
  items,
  onClose,
}: {
  name: string;
  x: number;
  y: number;
  items: { label: string; onSelect: () => void }[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Opened near the bottom or the right of the window, it opens up or to the left, so every item stays in reach.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const box = menu.getBoundingClientRect();
    if (box.bottom > window.innerHeight) menu.style.top = `${Math.max(4, window.innerHeight - box.height - 4)}px`;
    if (box.right > window.innerWidth) menu.style.left = `${Math.max(4, window.innerWidth - box.width - 4)}px`;
  }, [x, y, items.length]);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="cad-feature-menu"
      role="menu"
      aria-label={`${name} actions`}
      style={{ left: x, top: y }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') onClose();
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const all = [...ref.current!.querySelectorAll<HTMLElement>('[role=menuitem]')];
          const at = all.indexOf(document.activeElement as HTMLElement);
          all[(at + (event.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
        }
      }}>
      {items.map(item => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            item.onSelect();
          }}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

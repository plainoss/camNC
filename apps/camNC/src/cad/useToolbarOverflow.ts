import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * How many of `count` toolbar items fit in the group `ref` points at, leaving room for a More control when some do
 * not. Items keep their order, so the first ones stay in the toolbar and the rest belong in the More menu.
 *
 * `measureRef` points at an invisible copy of every item followed by the More control, laid out in one row outside
 * the flow: the items moved into the menu have no box of their own, and the copy keeps their widths current as fonts
 * and styles load. The group must grow into the toolbar's free width and be able to shrink below its content
 * (`flex: 1 1 auto; min-width: 0`), so that its width is the room there is whether items are hidden or not.
 */
export function useToolbarOverflow<Group extends HTMLElement, Measure extends HTMLElement>(count: number) {
  const ref = useRef<Group>(null);
  const measureRef = useRef<Measure>(null);
  const [visible, setVisible] = useState(count);

  const measure = useCallback(() => {
    const group = ref.current;
    const row = measureRef.current;
    if (!group || !row) return;
    const boxes = [...row.children].map(child => child.getBoundingClientRect().width);
    const widths = boxes.slice(0, count);
    const more = boxes[count] ?? 0;
    const style = getComputedStyle(group);
    const gap = Number.parseFloat(style.columnGap) || 0;
    const available = group.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
    const total = widths.reduce((sum, width, index) => sum + (index > 0 ? gap : 0) + width, 0);
    if (total <= available) {
      setVisible(count);
      return;
    }
    let used = more;
    let fits = 0;
    while (fits < count && used + gap + widths[fits]! <= available) used += gap + widths[fits++]!;
    setVisible(fits);
  }, [count]);

  // Measure before paint, and again whenever the room or the items change size (window resize, panels, fonts).
  useLayoutEffect(() => {
    const group = ref.current;
    const row = measureRef.current;
    if (!group || !row) return;
    measure();
    const observer = new ResizeObserver(() => measure());
    observer.observe(group);
    observer.observe(row);
    return () => observer.disconnect();
  }, [measure]);

  return { ref, measureRef, visible: Math.min(visible, count) };
}

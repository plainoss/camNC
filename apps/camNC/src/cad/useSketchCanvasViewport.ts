import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { View } from './cadEditorShared';

export interface SketchCanvasBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the drawing sits in its pane, for the parts shown behind a sketch to line up with it. */
export function useSketchCanvasBox(svg: RefObject<SVGSVGElement | null>, showWorkspace: boolean, show3D: boolean) {
  const [canvasBox, setCanvasBox] = useState<SketchCanvasBox | null>(null);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const measure = () =>
      setCanvasBox(previous => {
        // A turned drawing's box isn't its size, but it turns about its middle.
        const box = element.getBoundingClientRect(),
          pane = (element.parentElement as HTMLElement).getBoundingClientRect(),
          width = element.clientWidth,
          height = element.clientHeight;
        const next = {
          left: box.left + box.width / 2 - width / 2 - pane.left,
          top: box.top + box.height / 2 - height / 2 - pane.top,
          width,
          height,
        };
        return previous && JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [svg, showWorkspace, show3D]);
  return canvasBox;
}

/** Zooms the sketch canvas about the pointer with the mouse wheel. */
export function useSketchWheelZoom(
  svg: RefObject<SVGSVGElement | null>,
  drawingGroup: RefObject<SVGGElement | null>,
  setView: Dispatch<SetStateAction<View>>
) {
  useEffect(() => {
    const canvas = svg.current;
    if (!canvas) return;
    const zoom = (event: WheelEvent) => {
      if (!event.deltaY) return;
      event.preventDefault();
      const matrix = (drawingGroup.current ?? canvas).getScreenCTM();
      if (!matrix) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      const factor = event.deltaY > 0 ? 1.12 : 1 / 1.12;
      setView(v => ({
        x: point.x + (v.x - point.x) * factor,
        y: point.y + (v.y - point.y) * factor,
        w: Math.max(10, Math.min(10000, v.w * factor)),
        h: Math.max(10, Math.min(10000, v.h * factor)),
      }));
    };
    // React's delegated wheel listener is passive; zoom must cancel page scrolling at this surface.
    canvas.addEventListener('wheel', zoom, { passive: false });
    return () => canvas.removeEventListener('wheel', zoom);
  }, [svg, drawingGroup, setView]);
}

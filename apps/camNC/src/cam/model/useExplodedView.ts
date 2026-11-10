import { useEffect, useRef, useState } from 'react';
import type { ModelView } from './ModelViewport';

const kDurationMs = 600;

/** Shared playback and scrubbing for the studio and imported model views. */
export function useExplodedView(view: ModelView, onViewChange: (view: ModelView) => void) {
  const [progress, setProgress] = useState(view === 'exploded' ? 1 : 0);
  const current = useRef(progress);
  const frame = useRef<number | null>(null);
  const target = useRef(progress);
  const update = (value: number) => {
    current.current = value;
    setProgress(value);
  };
  const stop = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => {
      if (media.matches && frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
        current.current = target.current;
        setProgress(target.current);
      }
    };
    media.addEventListener('change', changed);
    return () => {
      media.removeEventListener('change', changed);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);
  const chooseView = (next: ModelView) => {
    stop();
    onViewChange(next);
    const end = next === 'exploded' ? 1 : 0;
    target.current = end;
    // Choosing a view explicitly requests this spatial transition, including with Reduce Motion enabled.
    // Initial loading stays still; a later system-preference change can still stop playback above.
    if (next === 'flat' || current.current === end) {
      update(end);
      return;
    }
    const from = current.current;
    const start = performance.now();
    const tick = (now: number) => {
      const time = Math.min(1, Math.max(0, (now - start) / kDurationMs));
      const eased = time * time * (3 - 2 * time);
      update(from + (end - from) * eased);
      frame.current = time < 1 ? requestAnimationFrame(tick) : null;
    };
    frame.current = requestAnimationFrame(tick);
  };
  const scrub = (value: number) => {
    // Manual input owns the position immediately; a queued animation must not overwrite it.
    stop();
    target.current = Math.min(1, Math.max(0, value));
    update(target.current);
  };
  return {
    progress,
    chooseView,
    scrub,
    // Keep the exploded camera fit while assembling, then restore planes and the assembled fit at the endpoint.
    modelView: view === 'assembled' && progress > 0 ? 'exploded' : view,
  };
}

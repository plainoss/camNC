import { useRef, useState, type DragEvent } from 'react';
import { imageFromTransfer } from './externalImage';

/**
 * Drag-and-drop of an image anywhere on the AI artwork panel. The drop is the panel's: it must not also reach the
 * page-wide file drop, which would offer the file as a new CAM job.
 */
export function useImageDrop(onImage: (file: File) => void, disabled: boolean) {
  const [dropping, setDropping] = useState(false);
  // dragenter/dragleave fire for every child crossed; count them so the highlight doesn't flicker.
  const depth = useRef(0);
  const files = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
  return {
    dropping,
    handlers: {
      onDragEnter: (event: DragEvent) => {
        if (!files(event)) return;
        depth.current++;
        setDropping(true);
      },
      onDragOver: (event: DragEvent) => {
        if (!files(event)) return;
        event.preventDefault();
        event.stopPropagation();
      },
      onDragLeave: () => {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDropping(false);
      },
      onDrop: (event: DragEvent) => {
        if (!files(event)) return;
        event.preventDefault();
        event.stopPropagation();
        depth.current = 0;
        setDropping(false);
        const image = imageFromTransfer(event.dataTransfer);
        if (image && !disabled) onImage(image);
      },
    },
  };
}

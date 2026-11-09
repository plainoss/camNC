import { useCallback, useState } from 'react';
import type { CadConnectorPick } from './PartFeatureDialogs';

/**
 * A mate connector being picked in the view for a dialog: the dialog starts it, the view's next click on a part gives
 * the point back once, and the dialog stops it with null when it closes.
 */
export function usePointPicker() {
  const [picker, setPicker] = useState<((pick: CadConnectorPick) => void) | null>(null);
  const start = useCallback((picked: ((pick: CadConnectorPick) => void) | null) => setPicker(() => picked), []);
  const onPick = useCallback(
    (pick: CadConnectorPick) => {
      setPicker(null);
      picker?.(pick);
    },
    [picker]
  );
  return { start, onPick: picker ? onPick : undefined };
}

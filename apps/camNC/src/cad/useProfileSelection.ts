import { useMemo, useState } from 'react';
import { sketchOwnerId, type CadDocument, type CadDrawnOn } from '@wbcnc/cad';
import { extrudeRegionViews, withRegionToggled } from './extrudeRegionViews';
import { replaceExtrudeProfile } from './profileSelection';

export function useProfileSelection(
  document: CadDocument,
  feature: { kind: string; partId: string } | null,
  commit: (doc: CadDocument) => void,
  refuse: (message: string) => void
) {
  const [enabled, setEnabled] = useState(true);
  const [picked, setPicked] = useState<{ sketch: string; region?: string } | null>(null);
  const target = feature?.kind === 'extrude' ? document.parts.find(p => p.id === feature.partId) : undefined;
  const regions = useMemo(() => (target ? extrudeRegionViews(document, target) : []), [document, target]);
  const replace = (selection: Parameters<typeof replaceExtrudeProfile>[2]) => {
    if (!target || !enabled) return false;
    try {
      commit(replaceExtrudeProfile(document, target.id, selection));
    } catch (error) {
      refuse(error instanceof Error ? error.message : String(error));
    }
    return true;
  };
  return {
    regions,
    enabled: !!target && enabled,
    setEnabled,
    pickSketch: (sketch: string, region?: string) => {
      setPicked({ sketch, region });
      return replace({ sketch, region });
    },
    pickedProfile: (part: import('@wbcnc/cad').CadPart) =>
      picked && (picked.sketch === part.id || picked.sketch === sketchOwnerId(part)) && picked.region
        ? { ...part, regions: [picked.region] }
        : part,
    pickFace: (face: Extract<CadDrawnOn['on'], { partId: string }>) => replace({ face }),
    pickRegion: (id: string) => {
      if (target) commit(withRegionToggled(document, target.id, id));
    },
  };
}

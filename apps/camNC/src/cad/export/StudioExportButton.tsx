import { useState } from 'react';
import type { CadDocument, CadLengthUnit } from '@wbcnc/cad';
import { Button } from '@wbcnc/ui/components/button';
import { Box } from 'lucide-react';
import { loadShownState } from '../shownState';
import { ExportDialog, type ExportTarget } from './ExportDialog';

/** Export… for the whole studio: every part shown in the 3D view, as a STEP file. */
export function StudioExportButton({ design }: { design: () => CadDocument }) {
  const [target, setTarget] = useState<ExportTarget | null>(null);
  const [unit, setUnit] = useState<CadLengthUnit>('mm');
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground"
        title="Download the parts shown in the 3D view as a STEP file, for other CAD and CAM programs."
        onClick={() => {
          const document = design();
          // Hidden parts are what the 3D view hides, as it saved them.
          setUnit(document.lengthUnit ?? 'mm');
          setTarget({ kind: 'parts', name: document.name, document, hidden: new Set(loadShownState(document.id).hiddenParts) });
        }}>
        <Box /> Export…
      </Button>
      <ExportDialog target={target} unit={unit} onClose={() => setTarget(null)} />
    </>
  );
}

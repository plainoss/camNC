import type { CadDocument, CadDrawnOn, CadValueScope } from '@wbcnc/cad';
import { FilletDialog } from './FilletDialog';
import { MirrorDialog } from './MirrorDialog';
import type { CadConnectorPick } from './PartFeatureDialogs';

/** The Mirror and Fillet steps' dialogs, whichever is open, kept by the editor that opens them. */
export function ShapeStepDialogs({
  document,
  variables,
  mirror,
  fillet,
  commit,
  setMirror,
  setFillet,
  setDirectionPicker,
  pickEdge,
}: {
  document: CadDocument;
  variables?: CadValueScope;
  mirror: { partId: string; copyId?: string } | null;
  fillet: { partId?: string; filletId?: string } | null;
  commit: (document: CadDocument) => void;
  setMirror: (open: null) => void;
  setFillet: (open: null) => void;
  /** Hands the view's next plane or face pick to a dialog, or stops it with null. */
  setDirectionPicker: (picker: ((on: CadDrawnOn['on'], datum?: string) => void) | null) => void;
  pickEdge: (picked: ((pick: CadConnectorPick) => void) | null) => void;
}) {
  return (
    <>
      {fillet && (
        <FilletDialog
          key={fillet.filletId ?? 'new'}
          {...{ document, variables, ...fillet, pickEdge }}
          onSave={next => (commit(next), setFillet(null))}
          onCancel={() => setFillet(null)}
        />
      )}
      {mirror && (
        <MirrorDialog
          key={mirror.copyId ?? mirror.partId}
          document={document}
          {...mirror}
          pickPlane={picked => setDirectionPicker(picked)}
          onSave={next => (commit(next), setDirectionPicker(null), setMirror(null))}
          onCancel={() => (setDirectionPicker(null), setMirror(null))}
        />
      )}
    </>
  );
}

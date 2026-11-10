import type { ComponentProps } from 'react';
import type { CadDocument, CadDrawnOn, CadValueScope } from '@wbcnc/cad';
import { TransformDialog } from './TransformDialog';
import { VariableDialog } from './VariableDialog';
import { PlaneDialog } from './PlaneDialog';
import { ShapeStepDialogs } from './ShapeStepDialogs';

type Transform = { partId: string; copyId?: string; move?: boolean };
type Plane = { id?: string; preselected?: CadDrawnOn['on'] };
type ShapeProps = ComponentProps<typeof ShapeStepDialogs>;

/** Save-only feature dialogs share an ephemeral viewport candidate; acceptance alone publishes it. */
export function StudioStepDialogs({
  document,
  variables,
  transform,
  variable,
  plane,
  mirror,
  fillet,
  commit,
  onPreview,
  onConnectorsChange,
  setTransform,
  setVariable,
  setPlane,
  setMirror,
  setFillet,
  setDirectionPicker,
  pickPoint,
}: {
  document: CadDocument;
  variables: CadValueScope;
  transform: Transform | null;
  variable: { id?: string } | null;
  plane: Plane | null;
  mirror: ShapeProps['mirror'];
  fillet: ShapeProps['fillet'];
  commit: (document: CadDocument) => void;
  onPreview: (document: CadDocument | null) => void;
  onConnectorsChange: NonNullable<ComponentProps<typeof TransformDialog>['onConnectorsChange']>;
  setTransform: (value: null) => void;
  setVariable: (value: null) => void;
  setPlane: (value: null) => void;
  setMirror: (value: null) => void;
  setFillet: (value: null) => void;
  setDirectionPicker: ShapeProps['setDirectionPicker'];
  pickPoint: NonNullable<ComponentProps<typeof TransformDialog>['pickPoint']>;
}) {
  return (
    <>
      {transform &&
        (() => {
          const target = document.parts.find(candidate => candidate.id === transform.partId);
          return target ? (
            <TransformDialog
              key={`${target.id}:${transform.copyId ?? 'new'}`}
              document={document}
              part={target}
              copyId={transform.copyId}
              move={transform.move}
              variables={variables}
              onPreview={onPreview}
              onSave={next => {
                commit(next);
                setDirectionPicker(null);
                setTransform(null);
              }}
              onCancel={() => {
                setDirectionPicker(null);
                setTransform(null);
              }}
              pickDirection={picked => setDirectionPicker(picked)}
              pickPoint={pickPoint}
              onConnectorsChange={onConnectorsChange}
            />
          ) : null;
        })()}
      {variable && (
        <VariableDialog
          key={variable.id ?? 'new'}
          document={document}
          variableId={variable.id}
          onPreview={onPreview}
          onSave={next => {
            commit(next);
            setVariable(null);
          }}
          onCancel={() => setVariable(null)}
        />
      )}
      {
        <ShapeStepDialogs
          {...{ document, variables: variables, mirror: mirror, fillet: fillet, commit, onPreview }}
          {...{ setMirror: setMirror, setFillet: setFillet, pickEdge: pickPoint }}
          setDirectionPicker={setDirectionPicker}
        />
      }
      {plane && (
        <PlaneDialog
          key={plane.id ?? 'new'}
          document={document}
          planeId={plane.id}
          preselected={plane.preselected}
          variables={variables}
          pickPlane={picked => setDirectionPicker(picked)}
          onPreview={onPreview}
          onSave={next => {
            commit(next);
            setDirectionPicker(null);
            setPlane(null);
          }}
          onCancel={() => {
            setDirectionPicker(null);
            setPlane(null);
          }}
        />
      )}
    </>
  );
}

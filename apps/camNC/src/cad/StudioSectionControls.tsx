import { SectionViewPanel } from './SectionViewPanel';
import type { useStudioSection } from './useStudioSection';

type Section = ReturnType<typeof useStudioSection>;

/** Persistent controls keep an accepted section discoverable after its inspector closes. */
export function StudioSectionControls({ section, enabled }: { section: Section; enabled: boolean }) {
  return section.active ? (
    <>
      <button type="button" aria-label="Edit section view" aria-pressed={section.editing} disabled={!enabled} onClick={section.edit}>
        Edit section view
      </button>
      <button type="button" aria-keyshortcuts="Shift+X" title="Turn off section view (Shift+X)" onClick={section.turnOff}>
        Turn off section view
      </button>
    </>
  ) : (
    <button type="button" aria-label="Section view" aria-keyshortcuts="Shift+X" disabled={!enabled} onClick={section.start}>
      Section view <kbd>⇧ X</kbd>
    </button>
  );
}

export function StudioSectionInspector({ section, problem }: { section: Section; problem?: string | null }) {
  if (!section.editing) return null;
  return (
    <SectionViewPanel
      planes={section.planes}
      planeId={section.planeId}
      picking={section.picking}
      onSelectPlane={section.selectPlane}
      onPickFace={section.pick}
      offset={section.offset}
      onOffsetChange={section.setOffset}
      offsetProblem={section.offsetProblem}
      flipped={section.flipped}
      onFlip={section.flip}
      onViewNormal={section.normal}
      confirmReason={problem || section.reason}
      onConfirm={() => {
        if (!problem) section.confirm();
      }}
      onCancel={section.turnOff}
    />
  );
}

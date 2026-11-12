import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CadDocument } from '@wbcnc/cad';
import { cadProposal, type CadProposal } from '@wbcnc/cad-editor/proposal';
import { checkSvgCandidate } from '../../../../../packages/cad-script/src/svg';
import { SvgImportDialog, type SvgImportSelection } from './SvgImportDialog';
import { svgAssetsForDocument } from './svgAssets';
/** Small Insert entry. It builds and checks a proposal; the existing review UI owns Apply. */
export function SvgInsert({
  document,
  disabled,
  onProposal,
}: {
  document: CadDocument;
  disabled?: boolean;
  onProposal: (proposal: CadProposal) => void;
}) {
  const [open, setOpen] = useState(false),
    generation = useRef(0),
    latest = useRef({ document, disabled });
  latest.current = { document, disabled };
  useEffect(() => {
    const pending = generation;
    return () => {
      pending.current++;
    };
  }, []);
  const close = () => {
    generation.current++;
    setOpen(false);
  };
  const review = async (selection: SvgImportSelection) => {
    const token = ++generation.current,
      base = structuredClone(document);
    if (latest.current.disabled) throw new Error('Finish or cancel the current edit before importing SVG.');
    const store = svgAssetsForDocument(base.id),
      summary = store.register(selection.source, selection.name);
    const result = await checkSvgCandidate(base, store, { handle: summary.handle, placement: selection.placement, toolpaths: true });
    // A cancelled or replaced import must never open a late proposal.
    if (token !== generation.current) return;
    if (latest.current.disabled || JSON.stringify(latest.current.document) !== JSON.stringify(base))
      throw new Error('The design changed while SVG was checked. Review the import again.');
    if (!result.ok) throw new Error(result.report.errors.map(issue => issue.message).join(' ') || 'The imported SVG is not a valid part.');
    onProposal(cadProposal(base, result.document));
  };
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={event => {
          event.currentTarget.closest('details')?.removeAttribute('open');
          setOpen(true);
        }}>
        SVG…
      </button>
      {open && createPortal(<SvgImportDialog onImport={review} onClose={close} />, globalThis.document.body)}
    </>
  );
}

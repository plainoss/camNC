import type { CadDocument } from '@wbcnc/cad';
import { designSteps, type DesignStep } from './designSteps';
import './designStepsList.css';

const kIcons: Record<DesignStep['kind'], string> = {
  sketch: '✎',
  extrude: '▮',
  move: '⇥',
  faceSketch: '✎',
  cut: '⌴',
  copy: '⧉',
  pattern: '⋯',
  partCut: '⊟',
};

/** The design's steps in order. Clicking one selects its part and opens what it made. */
export function DesignStepsList({
  document,
  selectedPartId,
  onStep,
}: {
  document: CadDocument;
  selectedPartId: string | null;
  onStep: (step: DesignStep) => void;
}) {
  const steps = designSteps(document);
  if (!steps.length) return null;
  return (
    <section className="cad-design-steps" aria-label="Steps">
      <div className="cad-panel-heading">
        <h2>Steps</h2>
      </div>
      <ol>
        {steps.map(step => (
          <li key={step.id}>
            <button type="button" aria-current={step.partId === selectedPartId ? 'true' : undefined} onClick={() => onStep(step)}>
              <span aria-hidden="true">{kIcons[step.kind]}</span>
              <span>{step.label}</span>
              {step.detail && <small>{step.detail}</small>}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

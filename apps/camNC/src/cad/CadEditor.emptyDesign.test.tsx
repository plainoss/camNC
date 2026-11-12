import { addLine, createCadDocument, createCadPart } from '@wbcnc/cad';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { settled } from '@/test/settled';
import { CadEditor } from './CadEditor';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});

function open(line: boolean) {
  const source = createCadDocument();
  const part = createCadPart();
  if (line) part.sketch = addLine(part.sketch, { x1: 20, y1: 20, x2: 100, y2: 20 });
  source.parts.push(part);
  sessions.push(source.id);
  render(<CadEditor document={source} onDraftChange={() => {}} onFinish={() => {}} onCancel={() => {}} />);
}

describe('sketch progress card (#934)', () => {
  it('shows no card for a design with nothing drawn', async () => {
    open(false);
    // The sketch check has run once the status names the empty sketch.
    await screen.findAllByText('Empty sketch', undefined, { timeout: 20_000 });
    await settled({ timeout: 20_000 });
    expect(screen.queryByText('Sketch in progress')).toBeNull();
    expect(screen.queryByText('Finish is blocked')).toBeNull();
  }, 30_000);

  it('still shows the card once an open outline is started', async () => {
    open(true);
    await screen.findByText('Sketch in progress', undefined, { timeout: 20_000 });
    expect(screen.queryByText('Finish is blocked')).toBeNull();
  }, 30_000);
});

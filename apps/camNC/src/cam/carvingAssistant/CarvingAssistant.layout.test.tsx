import '@/style.css';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCarvingJob, type CamJobV1 } from '../jobDb';
import { defaultProvider, rememberAssistantCredentials } from '../../cad/assistant/keyStore';
import { createAssistantUsage } from '../../cad/assistant/runBudget';
import { CarvingAssistant } from './CarvingAssistant';
import { useCarvingAssistant } from './useCarvingAssistant';
import { generateCarvingAsset } from './generation';

vi.mock('./generation', () => ({ generateCarvingAsset: vi.fn() }));

const asset = {
  id: 'owl-1',
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 30"><rect width="40" height="30"/></svg>',
  prompt: 'An owl reading a book',
  summary: 'An owl with an open book.',
  title: 'Reading owl',
};

beforeEach(() => {
  rememberAssistantCredentials({ config: { ...defaultProvider, model: 'recorded' }, key: 'recorded-key' });
  vi.mocked(generateCarvingAsset).mockReset().mockResolvedValue({ asset, usage: createAssistantUsage() });
});
afterEach(() => {
  cleanup();
  rememberAssistantCredentials(null);
});

function Panel({ job }: { job: CamJobV1 }) {
  const session = useCarvingAssistant({ job, selectedId: null, onApply: () => {} });
  const { setOpen } = session;
  useEffect(() => setOpen(true), [setOpen]);
  if (!session.open) return null;
  return (
    // The side panel's width at a 1440 px window.
    <aside aria-label="AI artwork" style={{ width: 287 }}>
      <CarvingAssistant job={job} session={session} onClose={() => {}} />
    </aside>
  );
}

it('keeps the Generate, Refine picked and Variants row inside a narrow panel', async () => {
  const job = await createCarvingJob(undefined, { lettering: 'Welcome' });
  render(<Panel job={job} />);
  await screen.findByRole('complementary', { name: 'AI artwork' });
  fireEvent.click(screen.getByRole('button', { name: 'use Text SVG' }));
  fireEvent.change(screen.getByLabelText('What should it show?'), { target: { value: asset.prompt } });
  fireEvent.change(screen.getByLabelText('Variants'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await screen.findByRole('button', { name: 'Refine picked' }, { timeout: 20_000 });
  const panel = screen.getByRole('complementary', { name: 'AI artwork' }).getBoundingClientRect();
  for (const control of [
    screen.getByRole('button', { name: 'New ideas' }),
    screen.getByRole('button', { name: 'Refine picked' }),
    screen.getByLabelText('Variants'),
  ])
    expect(control.getBoundingClientRect().right).toBeLessThanOrEqual(panel.right + 0.5);
}, 30_000);

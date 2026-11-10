import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { createPlateDocument } from '@wbcnc/cad';
import { cadSession, endCadSession } from '@wbcnc/cad-editor/session';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelViewport } from '@/cam/model/ModelViewport';
import { CadEditor } from './CadEditor';
import { solveCadDocument } from './solveCad';

vi.mock('@/cam/model/ModelViewport', () => ({ ModelViewport: vi.fn(() => null) }));
const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
  vi.clearAllMocks();
});

const studioToolbar = () => within(screen.getByRole('toolbar', { name: 'Part Studio toolbar' }));
const highlighted = () => document.querySelectorAll('[data-command-highlight="true"]');
const checked = () =>
  waitFor(
    () => {
      expect(document.querySelector('.cad-editor')).toHaveAttribute('aria-busy', 'false');
      expect(screen.queryByText(/^Checking sketch/)).toBeNull();
    },
    { timeout: 20_000 }
  );
async function setup(width = 1200) {
  const source = (await solveCadDocument(createPlateDocument({ width: 60, height: 40 }))).document;
  const session = cadSession(source);
  sessions.push(source.id);
  const published = vi.fn();
  const { container } = render(
    <div style={{ width, height: 800, display: 'flex' }}>
      <CadEditor document={source} editSession={session} startIn3D onDraftChange={published} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await checked();
  await waitFor(() => expect(vi.mocked(ModelViewport).mock.lastCall![0].instanceIds).toHaveLength(1));
  const baseline = session.document;
  const past = [...session.past],
    future = [...session.future];
  published.mockClear();
  return {
    host: container.firstElementChild as HTMLElement,
    unchanged: () => {
      expect(published).not.toHaveBeenCalled();
      expect(session.document).toBe(baseline);
      expect(session.past).toEqual(past);
      expect(session.future).toEqual(future);
    },
  };
}
async function search(query: string) {
  await userEvent.click(screen.getByRole('button', { name: /Search tools/ }));
  const input = screen.getByRole('combobox', { name: 'Search tools' });
  await userEvent.fill(input, query);
  return input;
}

it.each(['Linear pattern', 'Circular pattern'])(
  'highlights the existing Pattern toolbar command for %s and respects the checkbox without activating it',
  async label => {
    const { unchanged } = await setup();
    const input = await search(label);
    const pattern = studioToolbar().getByRole('button', { name: 'Pattern' });
    expect(screen.getByRole('option', { name: label })).toHaveAttribute('aria-selected', 'true');
    expect(pattern).toHaveAttribute('data-command-highlight', 'true');
    expect(pattern).toHaveAttribute('aria-pressed', 'false');
    expect(getComputedStyle(pattern).outlineWidth).toBe('2px');
    const style = getComputedStyle(pattern),
      bounds = pattern.getBoundingClientRect();
    const clip = pattern.closest('.cad-drawing-tools')!.getBoundingClientRect();
    const outside = Math.max(0, Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset));
    expect(bounds.top - outside).toBeGreaterThanOrEqual(clip.top);
    expect(bounds.bottom + outside).toBeLessThanOrEqual(clip.bottom);
    expect(document.activeElement).toBe(input);
    expect(highlighted()).toHaveLength(1);
    const toggle = screen.getByRole('checkbox', { name: 'Highlight tool in toolbar' });
    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(highlighted()).toHaveLength(0);
    await userEvent.keyboard(' ');
    expect(toggle).toBeChecked();
    expect(pattern).toHaveAttribute('data-command-highlight', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Close search' }));
    expect(highlighted()).toHaveLength(0);
    unchanged();
  }
);

it('moves the toolbar highlight with keyboard and pointer results, clearing it for no matches, Escape and choice', async () => {
  const { unchanged } = await setup();
  const input = await search('r');
  const extrude = studioToolbar().getByRole('button', { name: 'Extrude' });
  const mirror = studioToolbar().getByRole('button', { name: 'Mirror' });
  await userEvent.hover(screen.getByRole('option', { name: 'Mirror' }));
  expect(mirror).toHaveAttribute('data-command-highlight', 'true');
  expect(extrude).not.toHaveAttribute('data-command-highlight');
  expect(document.activeElement).toBe(input);
  await userEvent.fill(input, 'pattern');
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByRole('option', { name: 'Circular pattern' })).toHaveAttribute('aria-selected', 'true');
  expect(studioToolbar().getByRole('button', { name: 'Pattern' })).toHaveAttribute('data-command-highlight', 'true');
  expect(highlighted()).toHaveLength(1);
  await userEvent.fill(input, 'no matching tool');
  expect(highlighted()).toHaveLength(0);
  await userEvent.fill(input, 'extrude');
  expect(extrude).toHaveAttribute('data-command-highlight', 'true');
  await userEvent.keyboard('{Escape}');
  expect(highlighted()).toHaveLength(0);
  await search('circular pattern');
  await userEvent.keyboard('{Enter}');
  expect(await screen.findByRole('dialog', { name: 'Circular pattern · Plate' })).toBeVisible();
  expect(highlighted()).toHaveLength(0);
  expect(studioToolbar().getByRole('button', { name: 'Pattern' })).toHaveAttribute('aria-pressed', 'true');
  unchanged();
});

it('clears studio highlighting on light dismiss and context change, retaining the sketch search highlight and active tool', async () => {
  const { unchanged } = await setup();
  await search('pattern');
  expect(studioToolbar().getByRole('button', { name: 'Pattern' })).toHaveAttribute('data-command-highlight', 'true');
  await userEvent.click(within(screen.getByRole('list', { name: 'Parts' })).getByRole('button', { name: 'Plate' }));
  await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Search tools' })).toBeNull());
  expect(highlighted()).toHaveLength(0);
  unchanged();
  const sketch = within(screen.getByRole('region', { name: 'Features' })).getByRole('button', { name: /^Sketch · Plate/ });
  await userEvent.dblClick(sketch);
  await checked();
  expect(screen.queryByRole('toolbar', { name: 'Part Studio toolbar' })).toBeNull();
  expect(highlighted()).toHaveLength(0);
  const input = await search('ellipse');
  const circle = screen.getByRole('button', { name: 'Circle (C)' });
  expect(circle.closest('[data-tool-group]')).toHaveAttribute('data-command-highlight', 'true');
  expect(circle).toHaveAttribute('aria-pressed', 'false');
  expect(document.activeElement).toBe(input);
  await userEvent.keyboard('{Enter}');
  expect(highlighted()).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Ellipse' })).toHaveAttribute('aria-pressed', 'true');
  expect(document.activeElement).toBe(screen.getByTestId('cad-canvas'));
  unchanged();
});

it('reveals the actual highlighted command in an overflowed toolbar without moving keyboard focus', async () => {
  const { unchanged } = await setup(700);
  const input = await search('circular pattern');
  const pattern = studioToolbar().getByRole('button', { name: 'Pattern' });
  const strip = pattern.closest('.cad-drawing-tools')!;
  expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth);
  await waitFor(() => {
    const button = pattern.getBoundingClientRect(),
      visible = strip.getBoundingClientRect();
    expect(button.left).toBeGreaterThanOrEqual(visible.left);
    expect(button.right).toBeLessThanOrEqual(visible.right);
  });
  expect(strip.scrollLeft).toBeGreaterThan(0);
  expect(pattern).toHaveAttribute('data-command-highlight', 'true');
  expect(document.activeElement).toBe(input);
  unchanged();
});

it('keeps the highlighted command visible when the toolbar narrows while search is open', async () => {
  const { host, unchanged } = await setup();
  const input = await search('circular pattern');
  const pattern = studioToolbar().getByRole('button', { name: 'Pattern' });
  host.style.width = '700px';
  await waitFor(() => {
    const button = pattern.getBoundingClientRect(),
      visible = pattern.closest('.cad-drawing-tools')!.getBoundingClientRect();
    expect(button.left).toBeGreaterThanOrEqual(visible.left);
    expect(button.right).toBeLessThanOrEqual(visible.right);
  });
  expect(document.activeElement).toBe(input);
  expect(pattern).toHaveAttribute('aria-pressed', 'false');
  unchanged();
});

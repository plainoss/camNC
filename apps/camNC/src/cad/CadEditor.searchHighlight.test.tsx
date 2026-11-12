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
  // The first render after the browser starts can take seconds under a parallel run.
  await waitFor(() => expect(vi.mocked(ModelViewport).mock.lastCall?.[0].instanceIds).toHaveLength(1), { timeout: 20_000 });
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

const moreMenu = () => screen.queryByRole('menu');
const moreButton = () => studioToolbar().getByRole('button', { name: /^More/ });

it('opens More to mark a highlighted command that does not fit, keeping focus in search, and closes it with the search', async () => {
  const { unchanged } = await setup(600);
  expect(studioToolbar().queryByRole('button', { name: 'Variable' })).toBeNull();
  const input = await search('variable');
  const menu = await screen.findByRole('menu');
  const item = within(menu).getByRole('menuitem', { name: 'Variable' });
  expect(item).toHaveAttribute('data-command-highlight', 'true');
  expect(item).not.toHaveAttribute('data-active');
  expect(getComputedStyle(item).outlineWidth).toBe('2px');
  expect(highlighted()).toHaveLength(1);
  expect(document.activeElement).toBe(input);
  // Typing keeps going to search while the menu shows the match, even with the pointer over it.
  await userEvent.hover(item);
  expect(document.activeElement).toBe(input);
  await userEvent.unhover(item);
  expect(document.activeElement).toBe(input);
  await userEvent.keyboard('{Backspace}');
  expect(input).toHaveValue('variabl');
  expect(document.activeElement).toBe(input);
  // A match that fits closes the menu search opened.
  await userEvent.fill(input, 'sketch');
  await waitFor(() => expect(moreMenu()).toBeNull());
  expect(studioToolbar().getByRole('button', { name: 'Sketch' })).toHaveAttribute('data-command-highlight', 'true');
  expect(document.activeElement).toBe(input);
  await userEvent.fill(input, 'variable');
  expect(await screen.findByRole('menu')).toBeVisible();
  expect(document.activeElement).toBe(input);
  await userEvent.click(screen.getByRole('button', { name: 'Close search' }));
  await waitFor(() => expect(moreMenu()).toBeNull());
  expect(highlighted()).toHaveLength(0);
  expect(document.activeElement).not.toBe(moreButton());
  expect(document.activeElement).toBe(screen.getByTestId('workspace-3d'));
  unchanged();
});

it('runs a command chosen from search while More shows it, without pulling focus back to More', async () => {
  await setup(600);
  await search('variable');
  expect(await screen.findByRole('menu')).toBeVisible();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(moreMenu()).toBeNull());
  expect(highlighted()).toHaveLength(0);
  expect(moreButton()).toHaveAttribute('data-active', 'true');
  expect(document.activeElement).not.toBe(moreButton());
  expect(document.activeElement).not.toBe(document.body);
});

it('follows the highlighted command into and out of More as the toolbar narrows and widens while search is open', async () => {
  const { host, unchanged } = await setup(1800);
  const input = await search('variable');
  expect(studioToolbar().getByRole('button', { name: 'Variable' })).toHaveAttribute('data-command-highlight', 'true');
  expect(moreMenu()).toBeNull();
  host.style.width = '600px';
  const menu = await screen.findByRole('menu');
  expect(within(menu).getByRole('menuitem', { name: 'Variable' })).toHaveAttribute('data-command-highlight', 'true');
  expect(document.activeElement).toBe(input);
  host.style.width = '1800px';
  await waitFor(() => expect(moreMenu()).toBeNull());
  expect(studioToolbar().getByRole('button', { name: 'Variable' })).toHaveAttribute('data-command-highlight', 'true');
  expect(document.activeElement).toBe(input);
  unchanged();
});

it('closes the search with Escape while More shows its match, also after the pointer crossed the menu', async () => {
  await setup(600);
  await search('variable');
  expect(await screen.findByRole('menu')).toBeVisible();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(moreMenu()).toBeNull());
  expect(screen.queryByRole('combobox', { name: 'Search tools' })).toBeNull();
  await search('variable');
  const menu = await screen.findByRole('menu');
  await userEvent.hover(within(menu).getByRole('menuitem', { name: 'Variable' }));
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(moreMenu()).toBeNull());
  expect(screen.queryByRole('combobox', { name: 'Search tools' })).toBeNull();
  expect(highlighted()).toHaveLength(0);
});

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudioToolbar } from './StudioToolbar';
import { kStudioCommands, type StudioCommand } from './studioCommands';
import './cad.css';

afterEach(cleanup);

function setup(width: number, disabled: Partial<Record<StudioCommand, string>> = {}, onCommand = vi.fn()) {
  const toolbar = (width: number) => (
    <div className="cad-editor" style={{ width }}>
      <StudioToolbar
        busy={false}
        disabled={disabled}
        active={null}
        canUndo={false}
        canRedo={false}
        canFinish={true}
        onCommand={onCommand}
        onUndo={() => {}}
        onRedo={() => {}}
        onCancel={() => {}}
        onFinish={() => {}}
        onSearch={() => {}}
      />
    </div>
  );
  const view = render(toolbar(width));
  return { onCommand, resize: (next: number) => view.rerender(toolbar(next)) };
}

const features = () => screen.getByRole('group', { name: 'Part Studio features' });

/** Every command is a visible toolbar button that is not clipped by the group's edge. */
function expectAllCommandsVisible() {
  const group = features().getBoundingClientRect();
  for (const command of kStudioCommands) {
    const button = within(features()).getByRole('button', { name: command.label });
    expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(group.right + 0.5);
  }
}

describe('studio toolbar overflow', () => {
  it('shows every feature command and no More control when the toolbar is wide', async () => {
    setup(1440);
    await waitFor(expectAllCommandsVisible);
    expect(screen.queryByRole('button', { name: /^More/ })).toBeNull();
  });

  it('moves the commands that do not fit into a More menu that runs them', async () => {
    const { onCommand, resize } = setup(700);
    const more = await screen.findByRole('button', { name: /^More/ });
    expect(within(features()).queryByRole('button', { name: 'Variable' })).toBeNull();
    // Nothing in the group is clipped: what is shown fits, the rest is in the menu.
    const group = features().getBoundingClientRect();
    for (const button of features().querySelectorAll('button')) {
      expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(group.right + 0.5);
    }
    await userEvent.click(more);
    const menu = await screen.findByRole('menu');
    const shown = within(features()).getAllByRole('button').length - 1;
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map(item => item.textContent)
    ).toEqual(kStudioCommands.slice(shown).map(command => command.label));
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Variable' }));
    expect(onCommand).toHaveBeenCalledWith('variable');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    // Widening the toolbar brings every command back and drops the menu.
    resize(1440);
    await waitFor(expectAllCommandsVisible);
    expect(screen.queryByRole('button', { name: /^More/ })).toBeNull();
    resize(700);
    expect(await screen.findByRole('button', { name: /^More/ })).toBeTruthy();
  });

  it('keeps a command that needs a selection disabled inside the More menu', async () => {
    const { onCommand } = setup(500, { mirror: 'Select a part to mirror first' });
    await userEvent.click(await screen.findByRole('button', { name: /^More/ }));
    const mirror = within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Mirror' });
    expect(mirror).toHaveAttribute('aria-disabled', 'true');
    // The browser driver refuses to click an aria-disabled element, so dispatch the click a pointer would.
    fireEvent.click(mirror);
    expect(onCommand).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('greys a disabled command in the More menu and highlights the open one, as the toolbar does', async () => {
    const view = render(
      <div className="cad-editor" style={{ width: 500 }}>
        <StudioToolbar
          busy={false}
          disabled={{ mirror: 'Select a part to mirror first' }}
          active="variable"
          canUndo={false}
          canRedo={false}
          canFinish={true}
          onCommand={() => {}}
          onUndo={() => {}}
          onRedo={() => {}}
          onCancel={() => {}}
          onFinish={() => {}}
        />
      </div>
    );
    await userEvent.click(await view.findByRole('button', { name: /^More/ }));
    const menu = await screen.findByRole('menu');
    const item = (name: string) => within(menu).getByRole('menuitem', { name });
    const style = (name: string) => getComputedStyle(item(name));
    const glyphColor = (name: string) => getComputedStyle(item(name).querySelector('svg')!).color;
    // The item keeps aria-disabled rather than a disabled menu item, so hovering it still shows the reason.
    expect(item('Mirror')).toHaveAttribute('aria-disabled', 'true');
    expect(style('Mirror').color).toBe('rgb(154, 167, 182)');
    expect(glyphColor('Mirror')).toBe('rgb(154, 167, 182)');
    expect(style('Plane').color).not.toBe('rgb(154, 167, 182)');
    expect(style('Variable').backgroundColor).toBe('rgb(223, 234, 248)');
    expect(style('Variable').color).toBe('rgb(23, 79, 143)');
    expect(glyphColor('Variable')).toBe('rgb(23, 79, 143)');
    expect(style('Plane').backgroundColor).not.toBe('rgb(223, 234, 248)');
  });

  it('leaves focus where a command chosen from More put it, as a dialog focusing its first field does', async () => {
    const field = document.createElement('input');
    field.setAttribute('aria-label', 'Variable name');
    document.body.append(field);
    try {
      // The command's dialog focuses its field once it has rendered: after the menu unmounted, before the menu's
      // deferred return of focus to More.
      setup(
        700,
        {},
        vi.fn(() => queueMicrotask(() => field.focus()))
      );
      screen.getByRole('button', { name: /^More/ }).focus();
      await userEvent.keyboard('{Enter}');
      const menu = await screen.findByRole('menu');
      await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
      // Typeahead moves to Variable, then Enter chooses it.
      await userEvent.keyboard('v');
      await waitFor(() => expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Variable' })));
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(document.activeElement).toBe(field);
    } finally {
      field.remove();
    }
  });

  it('runs nothing from an open More menu once the studio is busy, and closes it', async () => {
    const onCommand = vi.fn();
    const toolbar = (busy: boolean) => (
      <div className="cad-editor" style={{ width: 700 }}>
        <StudioToolbar
          busy={busy}
          disabled={{}}
          active={null}
          canUndo={false}
          canRedo={false}
          canFinish={true}
          onCommand={onCommand}
          onUndo={() => {}}
          onRedo={() => {}}
          onCancel={() => {}}
          onFinish={() => {}}
        />
      </div>
    );
    const view = render(toolbar(false));
    await userEvent.click(await screen.findByRole('button', { name: /^More/ }));
    const variable = within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Variable' });
    view.rerender(toolbar(true));
    fireEvent.click(variable);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    view.rerender(toolbar(false));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('marks the open command in More and in its menu', async () => {
    const view = render(
      <div className="cad-editor" style={{ width: 700 }}>
        <StudioToolbar
          busy={false}
          disabled={{}}
          active="variable"
          canUndo={false}
          canRedo={false}
          canFinish={true}
          onCommand={() => {}}
          onUndo={() => {}}
          onRedo={() => {}}
          onCancel={() => {}}
          onFinish={() => {}}
        />
      </div>
    );
    const more = await view.findByRole('button', { name: /^More/ });
    expect(more).not.toHaveAttribute('aria-pressed');
    expect(more).toHaveAccessibleDescription('Variable is open');
    await userEvent.click(more);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Variable' })).toHaveAttribute('aria-current', 'true');
    expect(within(menu).getByRole('menuitem', { name: 'Plane' })).not.toHaveAttribute('aria-current');
  });
});

describe('studio toolbar search highlight', () => {
  function toolbar(props: { searchHighlight?: StudioCommand | null; disabled?: Partial<Record<StudioCommand, string>>; busy?: boolean }) {
    return (
      <div className="cad-editor" style={{ width: 600 }}>
        <StudioToolbar
          busy={props.busy ?? false}
          disabled={props.disabled ?? {}}
          active={null}
          searchHighlight={props.searchHighlight}
          canUndo={false}
          canRedo={false}
          canFinish={true}
          onCommand={() => {}}
          onUndo={() => {}}
          onRedo={() => {}}
          onCancel={() => {}}
          onFinish={() => {}}
        />
      </div>
    );
  }

  it('does not open More for a highlighted command that needs something first, or while busy', async () => {
    const view = render(toolbar({}));
    await screen.findByRole('button', { name: /^More/ });
    view.rerender(toolbar({ searchHighlight: 'variable', disabled: { variable: 'Not now' } }));
    expect(screen.queryByRole('menu')).toBeNull();
    view.rerender(toolbar({ searchHighlight: 'variable', busy: true }));
    expect(screen.queryByRole('menu')).toBeNull();
    view.rerender(toolbar({ searchHighlight: 'variable' }));
    const item = within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Variable' });
    expect(item).toHaveAttribute('data-command-highlight', 'true');
  });

  it('leaves a More menu the user opened open when the search highlight moves on', async () => {
    const view = render(toolbar({}));
    await userEvent.click(await screen.findByRole('button', { name: /^More/ }));
    const menu = await screen.findByRole('menu');
    view.rerender(toolbar({ searchHighlight: 'variable' }));
    expect(within(menu).getByRole('menuitem', { name: 'Variable' })).toHaveAttribute('data-command-highlight', 'true');
    view.rerender(toolbar({ searchHighlight: null }));
    expect(screen.getByRole('menu')).toBeVisible();
    expect(within(menu).getByRole('menuitem', { name: 'Variable' })).not.toHaveAttribute('data-command-highlight');
  });
});

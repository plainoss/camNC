import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudioToolbar } from './StudioToolbar';
import { kStudioCommands, type StudioCommand } from './studioCommands';
import './cad.css';

afterEach(cleanup);

function setup(width: number, disabled: Partial<Record<StudioCommand, string>> = {}) {
  const onCommand = vi.fn();
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
});

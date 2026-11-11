import { screen, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';

/**
 * A Part Studio command as the toolbar offers it at the current width: its toolbar button when it fits, otherwise its
 * item in the More menu, which this opens.
 */
export async function studioCommand(name: string | RegExp): Promise<HTMLElement> {
  const features = within(screen.getByRole('group', { name: 'Part Studio features' }));
  const button = features.queryByRole('button', { name });
  if (button) return button;
  const more = features.getByRole('button', { name: /^More/ });
  if (more.getAttribute('aria-expanded') !== 'true') await userEvent.click(more);
  // The menu renders into a portal after the click; wait for it rather than assume it is there.
  const menu = await screen.findByRole('menu', {}, { timeout: 2000 });
  return within(menu).getByRole('menuitem', { name });
}

/** Closes the More menu, if open, after a test only looked at one of its commands. */
export async function closeStudioMenu() {
  if (screen.queryByRole('menu')) await userEvent.keyboard('{Escape}');
}

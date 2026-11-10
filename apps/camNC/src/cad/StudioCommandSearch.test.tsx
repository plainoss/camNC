import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { StudioCommandSearch } from './StudioCommandSearch';
import { resolveStudioSearchCommand } from './studioSearchCommands';
import './cad.css';

afterEach(cleanup);

it('keeps both pattern kinds unavailable when the existing command requires a selected part', async () => {
  const onCommand = vi.fn(),
    onClose = vi.fn();
  render(
    <StudioCommandSearch
      disabled={{ pattern: 'Select a part first' }}
      workspace={{ current: null }}
      onOpenChange={onClose}
      onCommand={onCommand}
    />
  );
  const input = screen.getByRole('combobox', { name: 'Search tools' });
  for (const query of ['linear pattern', 'circular pattern']) {
    await userEvent.fill(input, query);
    expect(screen.getByText('No tools found')).toBeVisible();
    expect(screen.queryByRole('option')).toBeNull();
    await userEvent.keyboard('{Enter}');
  }
  expect(onCommand).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it('resolves only known studio commands, keeping explicit part-pattern IDs separate from sketch tools', () => {
  expect(resolveStudioSearchCommand('linearPartPattern')).toEqual({ command: 'pattern', initialPatternKind: 'linear' });
  expect(resolveStudioSearchCommand('circularPartPattern')).toEqual({ command: 'pattern', initialPatternKind: 'circular' });
  expect(resolveStudioSearchCommand('pattern')).toEqual({ command: 'pattern' });
  expect(resolveStudioSearchCommand('extrude')).toEqual({ command: 'extrude' });
  expect(resolveStudioSearchCommand('circularPattern')).toBeUndefined();
  expect(resolveStudioSearchCommand('line')).toBeUndefined();
});

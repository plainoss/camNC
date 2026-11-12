import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it } from 'vitest';
import { WorkSteps } from './WorkSteps';
import { conversationItems, describeStep, turnOutcome } from './stepSummary';
import type { AssistantMessage } from './provider';

afterEach(cleanup);

const messages: AssistantMessage[] = [
  { role: 'user', text: 'A tray, 280 by 190.' },
  {
    role: 'assistant',
    text: '',
    calls: [{ id: 'c1', name: 'check_design', arguments: { recipe: 'pebble-tray', parameters: { width: 280 } } }],
    responseItems: [{ encrypted_content: 'private-provider-payload' }],
  },
  {
    role: 'tool',
    callId: 'c1',
    text: JSON.stringify({
      ok: false,
      requirements: { ok: false, checks: [{ requirement: 'minimumWall', passed: false, message: 'Outer wall is 12 mm, needs 18 mm.' }] },
    }),
  },
  {
    role: 'assistant',
    text: '',
    calls: [{ id: 'c2', name: 'check_design', arguments: { scriptId: 's1', patches: [{ oldText: 'a', newText: 'b' }] } }],
  },
  {
    role: 'tool',
    callId: 'c2',
    text: '{"ok":true}',
    images: [{ name: 'Top', mediaType: 'image/png', data: 'private-image-payload' }],
  },
  { role: 'assistant', text: 'Proposal: a pebble tray.' },
];

it('describes checks and repairs in plain words, with the failed requirement as the reason', () => {
  const items = conversationItems(messages);
  expect(items.map(item => item.kind)).toEqual(['message', 'work', 'message']);
  const steps = items[1]!.kind === 'work' ? items[1]!.steps : [];
  expect(describeStep(steps[0]!, false)).toEqual({
    text: 'Built from the pebble-tray recipe',
    outcome: 'failed',
    note: 'Outer wall is 12 mm, needs 18 mm.',
  });
  expect(describeStep(steps[1]!, false)).toMatchObject({ text: 'Repaired the script (1 edit)', outcome: 'passed' });
  expect(describeStep({ call: { id: 'x', name: 'cad_script_guide', arguments: {} } }, true)).toMatchObject({ outcome: 'working' });
});

it('folds finished work to one line and keeps raw tool data behind Details without image payloads', async () => {
  const items = conversationItems(messages);
  const steps = items[1]!.kind === 'work' ? items[1]!.steps : [];
  const view = render(<WorkSteps steps={steps} running={false} />);
  expect(screen.getByText('2 steps · 2 checks')).toBeDefined();
  await userEvent.click(screen.getByText('2 steps · 2 checks'));
  const list = screen.getByRole('list', { name: 'Assistant steps' });
  expect(within(list).getByText('Outer wall is 12 mm, needs 18 mm.')).toBeDefined();
  await userEvent.click(screen.getByText('Details'));
  expect(within(screen.getByRole('list', { name: 'Tool activity' })).getByText(/"recipe": "pebble-tray"/)).toBeDefined();
  expect(screen.getByText('1 design views returned; image data omitted.')).toBeDefined();
  expect(view.container.textContent).not.toContain('private-image-payload');
  expect(view.container.textContent).not.toContain('private-provider-payload');
});

it('shows the live activity while the turn runs', () => {
  render(<WorkSteps steps={[]} running activity="Checking attempt 1 of 5…" />);
  expect(screen.getByText('Checking attempt 1 of 5…')).toBeDefined();
});

it('marks a turn by its last check: passed with warnings, or failed, never a plain tick', () => {
  const check = (id: string, result: unknown) => ({
    call: { id, name: 'finalize_design', arguments: {} },
    result: { role: 'tool' as const, callId: id, text: JSON.stringify(result) },
  });
  const warned = check('w', {
    ok: true,
    report: {
      warnings: [
        { code: 'toolpath-missing', message: 'No tool can cut the slot.' },
        { code: 'empty-sketch', message: 'Sketch 2 is empty.' },
      ],
    },
  });
  expect(describeStep(warned, false)).toMatchObject({ outcome: 'warned', note: 'Passed with a warning: No tool can cut the slot.' });
  expect(turnOutcome([warned], false)).toBe('warned');
  const failed = check('f', { ok: false, errors: [{ message: 'The pocket is deeper than the stock.' }] });
  expect(turnOutcome([warned, failed], false)).toBe('failed');
  expect(turnOutcome([failed], true)).toBe('working');
  const view = render(<WorkSteps steps={[warned, failed]} running={false} />);
  expect(view.container.querySelector('details')?.dataset.outcome).toBe('failed');
  expect(view.container.querySelector('summary')?.textContent).not.toContain('✓');
});

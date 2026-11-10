import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it } from 'vitest';
import { ActivityView } from './ActivityView';
import type { AssistantMessage } from './provider';

afterEach(cleanup);

it('shows live tool inputs and receives results without rendering image payloads or provider metadata', async () => {
  const messages: AssistantMessage[] = [
    {
      role: 'assistant',
      text: '',
      calls: [{ id: 'check-1', name: 'check_design', arguments: { source: 'd => d.part("Plate").thickness(24)' } }],
      responseItems: [{ encrypted_content: 'private-provider-payload' }],
    },
  ];
  const view = render(<ActivityView messages={messages} activity="Checking attempt 1 of 5…" running />);
  await userEvent.click(screen.getByText('Agent activity'));
  expect(screen.getByText('Checking attempt 1 of 5…')).toBeDefined();
  expect(screen.getByText('In progress')).toBeDefined();
  await userEvent.click(screen.getByText('Inputs'));
  expect(screen.getByText(/d => d.part/)).toBeDefined();
  view.rerender(
    <ActivityView
      messages={[
        ...messages,
        {
          role: 'tool',
          callId: 'check-1',
          text: '{"ok":true,"thickness":24}',
          images: [{ name: 'Front', mediaType: 'image/png', data: 'private-image-payload' }],
        },
      ]}
      activity="Checked proposal ready to review."
      running={false}
    />
  );
  const tools = screen.getByRole('list', { name: 'Tool activity' });
  expect(within(tools).getByText('Result received')).toBeDefined();
  await userEvent.click(within(tools).getByText('Result'));
  expect(within(tools).getByText(/"thickness": 24/)).toBeDefined();
  expect(within(tools).getByText('1 design views returned; image data omitted.')).toBeDefined();
  expect(view.container.textContent).not.toContain('private-image-payload');
  expect(view.container.textContent).not.toContain('private-provider-payload');
});

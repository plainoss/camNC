import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ProviderSettings } from './ProviderSettings';
import '@/style.css';
import '@/cam/carvingAssistant/panel.css';

afterEach(cleanup);

it.each([240, 320, 480])('shows every provider name whole in a %ipx Carve panel', width => {
  render(
    <div className="carving-assistant" style={{ width }}>
      <ProviderSettings value={null} onSave={() => {}} />
    </div>
  );
  const buttons = screen.getAllByRole('radio');
  expect(buttons.map(button => button.textContent)).toEqual(['Anthropic', 'OpenAI', 'Gemini', 'Other…']);
  for (const button of buttons) expect(button.scrollWidth, button.textContent!).toBeLessThanOrEqual(button.clientWidth);
  const row = buttons[0]!.parentElement!.getBoundingClientRect();
  expect(row.right).toBeLessThanOrEqual(width + 0.5);
});

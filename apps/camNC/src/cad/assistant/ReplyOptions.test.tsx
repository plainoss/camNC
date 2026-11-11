import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import '../../style.css';
import '../cad.css';
import './dock.css';
import { ReplyOptions } from './ReplyOptions';
import type { AssistantChoiceSketch } from './choiceSketch';

const choices = [
  'Sculptural: A rounded seat with a gently arched base and a bold silhouette.',
  'Scandinavian: A slim rectangular seat with four splayed legs and clean, light proportions.',
];
const sketches: AssistantChoiceSketch[] = [
  {
    choiceIndex: 0,
    shapes: [
      { kind: 'ellipse', coords: [50, 25, 35, 12] },
      { kind: 'line', coords: [30, 37, 20, 86] },
      { kind: 'line', coords: [70, 37, 80, 86] },
    ],
  },
  {
    choiceIndex: 1,
    shapes: [
      { kind: 'rect', coords: [15, 20, 70, 14] },
      { kind: 'line', coords: [27, 34, 15, 86] },
      { kind: 'line', coords: [73, 34, 85, 86] },
    ],
  },
];

afterEach(() => {
  cleanup();
  document.querySelector('style[data-assistant-cascade-regression]')?.remove();
});

function options(question = { choices, sketches }, disabled = false) {
  const onReply = vi.fn();
  const view = render(
    <div className="cad-editor" style={{ position: 'relative', height: 780, width: 1000 }}>
      <div className="cad-assistant-dock">
        <ReplyOptions question={question} disabled={disabled} onReply={onReply} />
      </div>
    </div>
  );
  return { ...view, onReply };
}

it('renders distinct illustrative sketches and sends the full unchanged choice only when clicked', async () => {
  const { onReply } = options();
  const sculptural = screen.getByRole('button', { name: choices[0] });
  const scandinavian = screen.getByRole('button', { name: choices[1] });
  expect(sculptural.querySelector('ellipse')?.getAttribute('rx')).toBe('35');
  expect(sculptural.querySelector('rect')).toBeNull();
  expect(scandinavian.querySelector('rect')?.getAttribute('width')).toBe('70');
  expect(scandinavian.querySelector('ellipse')).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
  expect(onReply).not.toHaveBeenCalled();
  await userEvent.click(scandinavian);
  expect(onReply).toHaveBeenCalledExactlyOnceWith(choices[1]);
});

it('keeps text-only choices available without requiring illustrations or a title', async () => {
  const { onReply } = options({ choices: ['18 mm', '24 mm'], sketches: [] });
  expect(screen.queryByText('Illustration')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '18 mm' }));
  expect(onReply).toHaveBeenCalledExactlyOnceWith('18 mm');
});

it('disables every suggested reply while work is in progress', () => {
  const { onReply } = options(undefined, true);
  for (const button of screen.getAllByRole('button')) {
    expect(button).toHaveProperty('disabled', true);
    button.click();
  }
  expect(onReply).not.toHaveBeenCalled();
});

it('preserves the tinted option surface and border when a generic CAD button rule loads later', () => {
  options();
  const generic = document.createElement('style');
  generic.dataset.assistantCascadeRegression = '';
  generic.textContent = '.cad-editor button { background: transparent; border: 1px solid transparent; }';
  document.head.append(generic);
  const style = getComputedStyle(screen.getByRole('button', { name: choices[0] }));
  expect(style.backgroundColor).toBe('rgb(234, 245, 240)');
  expect(style.borderTopColor).toBe('rgb(169, 204, 194)');
  expect(style.borderTopWidth).toBe('1px');
  expect(style.color).toBe('rgb(35, 88, 76)');
});

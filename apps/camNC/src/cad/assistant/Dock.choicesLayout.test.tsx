import { createPlateDocument } from '@wbcnc/cad';
import { cleanup, render, screen } from '@testing-library/react';
import { page } from '@vitest/browser/context';
import { afterEach, it, expect } from 'vitest';
import '../../style.css';
import '../cad.css';
import { AssistantDock } from './Dock';
import { defaultProvider, rememberAssistantCredentials } from './keyStore';
import { writeConversation } from './conversationStore';
const originalViewport = { width: window.innerWidth, height: window.innerHeight };
afterEach(async () => {
  cleanup();
  rememberAssistantCredentials(null);
  await page.viewport(originalViewport.width, originalViewport.height);
});
it('keeps the question, both illustrated choices and Send visible on desktop and mobile', async () => {
  rememberAssistantCredentials({ config: { ...defaultProvider, model: 'recorded', images: true }, key: 'recorded-key' });
  const source = createPlateDocument();
  writeConversation(source.id, [
    { role: 'user', text: 'Help me design a wooden stool with a backrest.' },
    {
      role: 'assistant',
      text: '',
      calls: [
        {
          id: 'ask-capture',
          name: 'ask_user',
          arguments: {
            question: 'Which direction feels right for your stool?',
            choices: [
              'Sculptural: A thick disc seat, single wide cylindrical pedestal and low half-round back ring.',
              'Scandinavian: A slim round seat, splayed legs and a light curved backrest.',
            ],
            sketches: [
              {
                choiceIndex: 0,
                shapes: [
                  { kind: 'ellipse', coords: [50, 24, 34, 12] },
                  { kind: 'rect', coords: [16, 24, 68, 18] },
                  { kind: 'ellipse', coords: [50, 42, 34, 12] },
                  { kind: 'rect', coords: [36, 46, 28, 36] },
                  { kind: 'ellipse', coords: [50, 82, 14, 6] },
                  { kind: 'ellipse', coords: [50, 14, 30, 9] },
                ],
              },
              {
                choiceIndex: 1,
                shapes: [
                  { kind: 'ellipse', coords: [50, 40, 32, 9] },
                  { kind: 'line', coords: [30, 46, 20, 87] },
                  { kind: 'line', coords: [70, 46, 80, 87] },
                  { kind: 'line', coords: [50, 49, 52, 82] },
                  { kind: 'line', coords: [23, 37, 25, 17] },
                  { kind: 'line', coords: [77, 37, 75, 17] },
                  { kind: 'ellipse', coords: [50, 16, 25, 7] },
                ],
              },
            ],
          },
        },
      ],
    },
    { role: 'tool', callId: 'ask-capture', text: 'Waiting for your reply.' },
  ]);
  await page.viewport(1100, 850);
  render(
    <div
      className="cad-editor"
      style={{
        position: 'relative',
        width: 'min(1000px, 100vw)',
        height: 'calc(100vh - 24px)',
        containerType: 'inline-size',
        containerName: 'cad-editor',
      }}>
      <AssistantDock document={source} onProposal={() => {}} onClose={() => {}} />
    </div>
  );
  const panel = screen.getByRole('complementary', { name: 'Design assistant' });
  for (const [width, height] of [
    [1100, 850],
    [390, 844],
  ] as const) {
    await page.viewport(width, height);
    const log = screen.getByRole('log', { name: 'Conversation' }).getBoundingClientRect();
    const question = screen.getByText('Which direction feels right for your stool?').getBoundingClientRect();
    expect(question.top).toBeGreaterThanOrEqual(log.top);
    for (const button of screen.getByRole('group', { name: 'Suggested replies' }).querySelectorAll('button')) {
      expect(button.getBoundingClientRect().top).toBeGreaterThanOrEqual(log.top);
      expect(button.getBoundingClientRect().bottom).toBeLessThanOrEqual(log.bottom);
    }
    expect(screen.getByRole('button', { name: 'Send' }).getBoundingClientRect().bottom).toBeLessThanOrEqual(
      panel.getBoundingClientRect().bottom
    );
  }
});

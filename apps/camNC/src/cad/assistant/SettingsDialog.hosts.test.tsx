import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '@/style.css';
import '@/cam/carvingAssistant/panel.css';
import './dock.css';
import { ProviderSettings } from './ProviderSettings';
import { Requirements } from './RequirementSettings';
import { RunSettings } from './RunSettings';
import { AssistantSettingsDialog } from './SettingsDialog';

afterEach(cleanup);

function Dialog({ section }: { section: string }) {
  return (
    <AssistantSettingsDialog
      open
      section={section}
      onSection={() => {}}
      onClose={() => {}}
      sections={[
        { id: 'connection', label: 'Connection', content: <ProviderSettings value={null} onSave={() => {}} /> },
        { id: 'brief', label: 'Brief', content: <Requirements value={{}} onConfirm={() => {}} /> },
        {
          id: 'usage',
          label: 'Cost and limits',
          content: <RunSettings value={{ limits: {} }} usage={null} disabled={false} onChange={() => {}} />,
        },
      ]}
    />
  );
}

/** The Part Studio dock and the Carve panel: the two places the dialog opens from. */
const hosts = {
  dock: (section: string) => (
    <div className="cad-editor">
      <div className="cad-assistant-dock">
        <Dialog section={section} />
      </div>
    </div>
  ),
  carve: (section: string) => (
    <div className="carving-assistant">
      <Dialog section={section} />
    </div>
  ),
};

const shown = (label: string) => screen.getByRole('region', { name: label });

describe.each(Object.entries(hosts))('assistant settings opened from the %s (#916)', (_, host) => {
  it('draws the connection form unboxed, with its heading and a filled submit button', () => {
    render(host('connection'));
    const form = shown('Connection').querySelector('form')!;
    const style = getComputedStyle(form);
    expect([style.borderTopWidth, style.paddingTop, style.borderTopLeftRadius]).toEqual(['0px', '0px', '0px']);
    const heading = getComputedStyle(within(form).getByRole('heading', { name: 'Connect an AI provider' }));
    expect([heading.fontSize, heading.fontWeight]).toEqual(['18px', '600']);
    const submit = getComputedStyle(within(form).getByRole('button', { name: 'Test and connect' }));
    expect([submit.backgroundColor, submit.color]).toEqual(['rgb(23, 108, 97)', 'rgb(255, 255, 255)']);
  });

  it.each([
    ['Brief', 'Part outline width (mm)'],
    ['Cost and limits', 'USD limit (optional)'],
  ])('shows the %s form as soon as its section is picked', (label, field) => {
    render(host(label === 'Brief' ? 'brief' : 'usage'));
    const section = shown(label);
    expect(section.querySelector('details')).toBeNull();
    expect(within(section).getByLabelText(field).checkVisibility()).toBe(true);
    expect(getComputedStyle(section.firstElementChild!).borderTopWidth).toBe('0px');
  });
});

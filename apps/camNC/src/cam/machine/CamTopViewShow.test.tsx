import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TooltipProvider } from '@wbcnc/ui/components/tooltip';
import { afterEach, expect, it } from 'vitest';
import { useCamMachine } from './camMachine';
import { CamTopViewShow } from './CamTopViewShow';

afterEach(() => {
  cleanup();
  useCamMachine.setState(useCamMachine.getInitialState(), true);
});

it('is a Layers menu in the header that picks what the top view shows', async () => {
  useCamMachine.setState({
    jobId: 'job',
    overlay: { boardId: 'b', w: 100, h: 80, rotationDeg: 0, parts: [] } as never,
    showInTopView: 'program',
  });
  render(
    <TooltipProvider>
      <CamTopViewShow />
    </TooltipProvider>
  );
  expect(screen.queryByRole('radiogroup')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show in the top view' }));
  const all = await screen.findByRole('radio', { name: /All programs/ });
  expect(screen.getByRole('radio', { name: /This program/ }).getAttribute('aria-checked')).toBe('true');
  fireEvent.click(all);
  expect(useCamMachine.getState().showInTopView).toBe('all');
});

it('shows nothing without a CAM job at the machine', () => {
  const { container } = render(<CamTopViewShow />);
  expect(container.textContent).toBe('');
});

import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConnectionBadge, MachineStateBadge } from './MachineStatusBar';

const api = vi.hoisted(() => ({
  connection: { value: 'connected' },
  status: { value: { state: 'Idle', subState: undefined as number | undefined } },
  alarm: { value: null },
}));
vi.mock('@/lib/fluidnc/machine', () => ({ getCncApi: () => api }));
vi.mock('@/store/store', () => ({ useStore: () => false }));
vi.mock('@wbcnc/i18n', async importOriginal => {
  const actual = await importOriginal<typeof import('@wbcnc/i18n')>();
  return { ...actual, t: actual.i18n.getFixedT('fr') };
});
afterEach(cleanup);

it('localizes connection labels without changing connection identifiers', () => {
  const { container } = render(<ConnectionBadge />);
  expect(container.textContent).toContain('Connecté');
  expect(api.connection.value).toBe('connected');
});

it('localizes a controller state while keeping its raw code accessible', () => {
  const { container } = render(<MachineStateBadge />);
  expect(container.textContent).toBe('À l’arrêt');
  expect(container.querySelector('[data-testid="machine-state"]')?.getAttribute('title')).toBe('Idle');
  expect(api.status.value.state).toBe('Idle');
});

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { usePlanProgress } from '../planProgress';
import { PlanningProgress } from './PlanningProgress';

afterEach(() => {
  cleanup();
  usePlanProgress.setState({}, true);
});

describe('PlanningProgress', () => {
  it('says it is computing before the worker reports, then how far it got and the time left', () => {
    render(<PlanningProgress boardId="a" />);
    expect(screen.getByRole('status').textContent).toBe('Computing toolpaths…');
    expect(screen.queryByRole('progressbar')).toBeNull();
    act(() => usePlanProgress.setState({ a: { fraction: 0.5, startedAt: performance.now() - 20_000 } }));
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
    expect(screen.getByRole('status').textContent).toContain('50%');
    expect(screen.getByRole('status').textContent).toContain('about 20 s left');
  });

  it('over the last toolpaths, waits a moment so a quick plan does not flash it', () => {
    usePlanProgress.setState({ a: { fraction: 0.2, startedAt: performance.now() } });
    const { container } = render(<PlanningProgress boardId="a" after={1000} />);
    expect(container.textContent).toBe('');
  });
});

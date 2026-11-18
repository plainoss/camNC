import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { sectionPlaneName } from './sectionPlaneName';
import { StudioViewMenu } from './StudioViewMenu';

afterEach(cleanup);

const open = () => fireEvent.click(screen.getByRole('button', { name: 'View menu' }));

it('switches perspective on and off, a check showing which', () => {
  const onPerspective = vi.fn();
  const { rerender } = render(<StudioViewMenu designId="d" onViewRequest={() => {}} perspective={false} onPerspective={onPerspective} />);
  open();
  const item = screen.getByRole('menuitemcheckbox', { name: 'Perspective view' });
  expect(item.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(item);
  expect(onPerspective).toHaveBeenCalledWith(true);
  rerender(<StudioViewMenu designId="d" onViewRequest={() => {}} perspective onPerspective={onPerspective} />);
  open();
  expect(screen.getByRole('menuitemcheckbox', { name: 'Perspective view' }).getAttribute('aria-checked')).toBe('true');
});

it('starts a section view, and while one is on offers to edit it or turn it off', () => {
  const section = { active: false, enabled: true, start: vi.fn(), edit: vi.fn(), turnOff: vi.fn() };
  const { rerender } = render(<StudioViewMenu designId="d" onViewRequest={() => {}} section={section} />);
  open();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Section view…' }));
  expect(section.start).toHaveBeenCalled();
  rerender(<StudioViewMenu designId="d" onViewRequest={() => {}} section={{ ...section, active: true }} />);
  open();
  expect(screen.queryByRole('menuitem', { name: 'Section view…' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit section view…' }));
  expect(section.edit).toHaveBeenCalled();
  open();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Turn off section view' }));
  expect(section.turnOff).toHaveBeenCalled();
});

it('names a section plane by the side it faces: moved against its normal or flipped, the opposite one', () => {
  expect(sectionPlaneName('Front', '0', false)).toBe('Section plane 1 (Front)');
  expect(sectionPlaneName('Front', '-20', false)).toBe('Section plane 1 (Back)');
  expect(sectionPlaneName('Front', '-20', true)).toBe('Section plane 1 (Front)');
  expect(sectionPlaneName('Top', '5 mm', true)).toBe('Section plane 1 (Bottom)');
  expect(sectionPlaneName('Part 1 face', '-3', false)).toBe('Section plane 1 (Part 1 face)');
});

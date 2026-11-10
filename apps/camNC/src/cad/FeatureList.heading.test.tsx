import { cleanup, render, screen, within } from '@testing-library/react';
import { createPlateDocument } from '@wbcnc/cad';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { FeatureList } from './FeatureList';
import './cad.css';

afterEach(cleanup);

it.each([238, 190])('keeps the Features count on one line beside an operable folder action at %ipx', async width => {
  const document = createPlateDocument({ width: 120, height: 80, thickness: 18 });
  const before = JSON.stringify(document);
  const onChange = vi.fn();
  render(
    <div className="cad-editor" style={{ width }}>
      <FeatureList
        document={document}
        selectedPartId={null}
        onSelect={() => {}}
        onAction={() => {}}
        onRename={() => {}}
        onChange={onChange}
      />
    </div>
  );
  const heading = screen.getByRole('heading', { name: /^Features \(/ });
  const action = screen.getByRole('button', { name: /^New folder$/ });
  const text = window.document.createRange();
  text.selectNodeContents(heading);
  // A full-width row style on the action used to squeeze the count onto a second line.
  expect(new Set(Array.from(text.getClientRects(), rect => Math.round(rect.top))).size).toBe(1);
  const labelBox = heading.getBoundingClientRect();
  const actionBox = action.getBoundingClientRect();
  const headerBox = heading.parentElement!.getBoundingClientRect();
  expect(labelBox.right).toBeLessThanOrEqual(actionBox.left);
  expect(actionBox.right).toBeLessThanOrEqual(headerBox.right);
  expect(actionBox.width).toBeGreaterThanOrEqual(24);
  expect(actionBox.height).toBeGreaterThanOrEqual(24);

  action.focus();
  await userEvent.keyboard('{Enter}');
  const dialog = screen.getByRole('dialog', { name: 'New folder' });
  await userEvent.click(within(dialog).getByRole('button', { name: /^Cancel$/ }));
  expect(screen.queryByRole('dialog', { name: 'New folder' })).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  expect(JSON.stringify(document)).toBe(before);
});

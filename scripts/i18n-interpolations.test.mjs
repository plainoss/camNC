import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExpression } from '@babel/parser';
import { untranslatedDisplayText } from './i18n-interpolations.mjs';

test('detects English display branches nested in translated parameters', () => {
  assert.deepEqual(untranslatedDisplayText(parseExpression("clamp ? 'clamp' : 'screw'")), ['clamp', 'screw']);
  assert.deepEqual(untranslatedDisplayText(parseExpression("changed ? ` (${distance} mm from the old zero)` : ''")), [' mm from the old zero)']);
});
test('preserves condition IDs, translated branches, names, punctuation and technical units', () => {
  assert.deepEqual(untranslatedDisplayText(parseExpression("mode === 'clamp' ? translate('Clamp') : translate('Screw')")), []);
  assert.deepEqual(untranslatedDisplayText(parseExpression("selected ? part.name : ''")), []);
  assert.deepEqual(untranslatedDisplayText(parseExpression("angle ? 'deg' : 'mm'")), []);
  assert.deepEqual(untranslatedDisplayText(parseExpression("changed ? ` (${distance})` : ''")), []);
});

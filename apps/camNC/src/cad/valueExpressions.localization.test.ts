import { afterEach, expect, it } from 'vitest';
import { i18n } from '@wbcnc/i18n';
import { parseCadValue as parseHeadless } from '@wbcnc/cad';
import { parseCadValue } from './valueExpressions';
import { localizeCadValueError } from './localizeCadValueError';

afterEach(() => i18n.changeLanguage('en'));

it('localizes application input errors while preserving the headless report', async () => {
  await i18n.changeLanguage('fr');
  expect(parseCadValue('1/0')).toEqual({ error: 'Impossible de diviser par zéro.' });
  expect(parseCadValue('')).toEqual({ error: 'Saisissez une valeur.' });
  expect(parseCadValue('(2+3')).toEqual({ error: 'Fermez les parenthèses.' });
  expect(parseHeadless('1/0')).toEqual({ error: 'Cannot divide by zero.' });
});

it('preserves names and numbers in parameterized parser diagnostics', async () => {
  await i18n.changeLanguage('fr');
  expect(parseCadValue('#missing')).toEqual({ error: 'Aucune variable ne s’appelle missing.' });
  expect(localizeCadValueError('Unknown unit: furlong.')).toBe('Unité inconnue : furlong.');
  expect(localizeCadValueError('min needs at least two arguments. Separate values with ", " or ";".')).toBe(
    'min attend au moins deux arguments. Séparez les valeurs par ", " ou ";".'
  );
  expect(localizeCadValueError('Use an absolute value of at most 10000 degrees.')).toBe(
    'Utilisez une valeur absolue ne dépassant pas 10000 degrés.'
  );
});

it('keeps successful numerical and serialized expression results identical', async () => {
  await i18n.changeLanguage('fr');
  for (const text of ['2+3', '1/4 in', 'sqrt(9)', '2.5 mm']) expect(parseCadValue(text)).toEqual(parseHeadless(text));
});

it('preserves an unrecognized diagnostic instead of hiding it', () => {
  expect(localizeCadValueError('External diagnostic 17')).toBe('External diagnostic 17');
});

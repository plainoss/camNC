import { t as translate } from '@wbcnc/i18n';

/** Localize only the application's known value-parser diagnostics, leaving the headless parser unchanged. */
export function localizeCadValueError(message: string): string {
  switch (message) {
    case 'A unitless ratio cannot be added to a length or angle.':
      return translate('A unitless ratio cannot be added to a length or angle.');
    case 'Ambiguous comma group: use a decimal point or remove thousands separators.':
      return translate('Ambiguous comma group: use a decimal point or remove thousands separators.');
    case 'Cannot divide by zero.':
      return translate('Cannot divide by zero.');
    case 'Cannot take the square root of a negative value.':
      return translate('Cannot take the square root of a negative value.');
    case 'Close the parentheses.':
      return translate('Close the parentheses.');
    case 'Enter a number or a parenthesized expression.':
      return translate('Enter a number or a parenthesized expression.');
    case 'Enter a valid arithmetic expression.':
      return translate('Enter a valid arithmetic expression.');
    case 'Enter a value.':
      return translate('Enter a value.');
    case 'Put units on each added value, or put the whole sum in parentheses before its unit.':
      return translate('Put units on each added value, or put the whole sum in parentheses before its unit.');
    case 'Put units on each fraction, or put the whole sum in parentheses before its unit.':
      return translate('Put units on each fraction, or put the whole sum in parentheses before its unit.');
    case 'Separate values with an operator and check the parentheses.':
      return translate('Separate values with an operator and check the parentheses.');
    case 'The expression must produce a length or angle, not compound units.':
      return translate('The expression must produce a length or angle, not compound units.');
    case 'The expression must produce a length, not a squared length: take its sqrt(...).':
      return translate('The expression must produce a length, not a squared length: take its sqrt(...).');
    case 'The expression must produce a length, not a unitless ratio.':
      return translate('The expression must produce a length, not a unitless ratio.');
    case 'The expression must produce an angle, not a unitless ratio.':
      return translate('The expression must produce an angle, not a unitless ratio.');
    case 'The number is too small to represent.':
      return translate('The number is too small to represent.');
    case 'The result is outside the supported numeric range.':
      return translate('The result is outside the supported numeric range.');
    case 'The result is too small to represent.':
      return translate('The result is too small to represent.');
    case 'This expression is too long.':
      return translate('This expression is too long.');
    case 'This value already has a unit.':
      return translate('This value already has a unit.');
    case 'Too many nested parentheses or signs.':
      return translate('Too many nested parentheses or signs.');
    case 'Use a unitless value; length and angle units are not accepted.':
      return translate('Use a unitless value; length and angle units are not accepted.');
    case 'Use angle units: deg or rad.':
      return translate('Use angle units: deg or rad.');
    case 'Use length units: mm, cm, m, in, inch or ft.':
      return translate('Use length units: mm, cm, m, in, inch or ft.');
    case 'Use numbers, units, functions, +, -, *, /, parentheses and ;.':
      return translate('Use numbers, units, functions, +, -, *, /, parentheses and ;.');
    case 'sqrt needs a unitless value or a squared length.':
      return translate('sqrt needs a unitless value or a squared length.');
  }
  {
    const match = message.match(/^Keep values and intermediate results within ±(.+)\.$/);
    if (match) return translate('Keep values and intermediate results within ±{{limit}}.', { limit: match[1] });
  }
  {
    const match = message.match(/^Put \* between the number and (.+)\.$/);
    if (match) return translate('Put * between the number and {{name}}.', { name: match[1] });
  }
  {
    const match = message.match(/^Unknown unit: (.+)\.$/);
    if (match) return translate('Unknown unit: {{name}}.', { name: match[1] });
  }
  {
    const match = message.match(/^Unknown function: (.+)\.$/);
    if (match) return translate('Unknown function: {{name}}.', { name: match[1] });
  }
  {
    const match = message.match(/^(.+) needs at least two arguments\. Separate values with ", " or ";"\.$/);
    if (match) return translate('{{name}} needs at least two arguments. Separate values with ", " or ";".', { name: match[1] });
  }
  {
    const match = message.match(/^(.+) needs exactly one argument\.$/);
    if (match) return translate('{{name}} needs exactly one argument.', { name: match[1] });
  }
  {
    const match = message.match(/^Use parentheses after (.+): (.+)\(\.\.\.\)\.$/);
    if (match) return translate('Use parentheses after {{name}}: {{example}}(...).', { name: match[1], example: match[2] });
  }
  {
    const match = message.match(/^There's no variable called (.+)\.$/);
    if (match) return translate("There's no variable called {{name}}.", { name: match[1] });
  }
  {
    const match = message.match(/^Use an absolute value of at most ([^ ]+)( mm| degrees)?\.$/);
    if (match)
      return translate('Use an absolute value of at most {{limit}}{{unit}}.', {
        limit: match[1],
        unit: match[2] === ' degrees' ? translate(' degrees') : (match[2] ?? ''),
      });
  }
  return message;
}

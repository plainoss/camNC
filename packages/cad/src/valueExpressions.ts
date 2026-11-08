import { isBareBaseUnitLiteral } from './dimensionExpressions';

export type CadValueUnit = 'mm' | 'deg' | 'scalar';
export type CadValueResult = { value: number; expression?: string } | { error: string };
export type CadVariableKind = 'length' | 'angle' | 'number';
/** Named values an expression may use, by name. Lengths are mm and angles degrees. */
export type CadValueScope = Readonly<Record<string, { value: number; kind: CadVariableKind }>>;

interface Quantity {
  value: number;
  dimension: 'length' | 'angle' | null;
  explicitUnits: boolean;
  /** A unit was typed, like `in`, rather than coming only from variables. */
  typedUnit: boolean;
  fraction: boolean;
}
/** A word is a unit or a variable name. */
type Token = { kind: 'number'; value: number } | { kind: 'word'; text: string } | { kind: 'operator'; text: string };

const plainNumber = /^[+-]?(?:\d+[.,]?\d*|[.,]\d+)(?:e[+-]?\d+)?$/i;
/** Normalized millimetres/degrees, before any value is published to a sketch or sent to WASM. */
export const CAD_MAX_INPUT_MAGNITUDE = 100_000;
const unitFactors: Record<string, { dimension: 'length' | 'angle'; factor: number }> = {
  mm: { dimension: 'length', factor: 1 },
  cm: { dimension: 'length', factor: 10 },
  m: { dimension: 'length', factor: 1000 },
  in: { dimension: 'length', factor: 25.4 },
  inch: { dimension: 'length', factor: 25.4 },
  inches: { dimension: 'length', factor: 25.4 },
  '"': { dimension: 'length', factor: 25.4 },
  '″': { dimension: 'length', factor: 25.4 },
  ft: { dimension: 'length', factor: 304.8 },
  deg: { dimension: 'angle', factor: 1 },
  rad: { dimension: 'angle', factor: 180 / Math.PI },
  '°': { dimension: 'angle', factor: 1 },
};

function checked(value: number): number {
  if (!Number.isFinite(value)) throw new Error('The result is outside the supported numeric range.');
  if (Math.abs(value) > CAD_MAX_INPUT_MAGNITUDE)
    throw new Error(`Keep values and intermediate results within ±${CAD_MAX_INPUT_MAGNITUDE}.`);
  return value === 0 ? 0 : value;
}

const unitFor = (text: string) => {
  const key = text === 'M' ? text : text.toLowerCase();
  return Object.hasOwn(unitFactors, key) ? unitFactors[key] : undefined;
};

function tokenize(text: string, unitsOnly = false): Token[] {
  const result: Token[] = [];
  for (let index = 0; index < text.length; ) {
    const rest = text.slice(index);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }
    const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)(?![\d.e])/i.exec(rest);
    const numeric = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(rest);
    if (mixed) {
      const whole = unitsOnly ? 0 : checked(Number(mixed[1])),
        numerator = unitsOnly ? 0 : checked(Number(mixed[2])),
        denominator = unitsOnly ? 1 : checked(Number(mixed[3]));
      if (denominator === 0) throw new Error('Cannot divide by zero.');
      result.push({ kind: 'number', value: checked(whole + checked(numerator / denominator)) });
      index += mixed[0].length;
    } else if (numeric) {
      const value = unitsOnly ? 0 : checked(Number(numeric[0]));
      if (!unitsOnly && value === 0 && /[1-9]/.test(numeric[0].split(/e/i)[0]!)) throw new Error('The number is too small to represent.');
      result.push({ kind: 'number', value });
      index += numeric[0].length;
    } else {
      const word = /^(?:#?[a-z_][a-z0-9_]*|°|"|″)/i.exec(rest);
      if (word) {
        result.push({ kind: 'word', text: word[0] });
        index += word[0].length;
      } else if ('+-*/()'.includes(text[index]!)) {
        result.push({ kind: 'operator', text: text[index]! });
        index++;
      } else if (unitsOnly) {
        index++;
        continue;
      } else throw new Error('Use numbers, units, +, -, *, / and parentheses.');
    }
    if (result.length > 256) {
      if (unitsOnly) return result;
      throw new Error('This expression is too long.');
    }
  }
  return result;
}

/** Display only: use the same lexer and unit table even while an expression is incomplete or invalid. */
export function cadValueHasUnit(text: string): boolean {
  return tokenize(text.slice(0, 512), true).some(token => token.kind === 'word' && unitFor(token.text) !== undefined);
}

const variableName = (word: string) => word.replace(/^#/, '');
const kNamePattern = /^[a-z_][a-z0-9_]*$/i;

/** Why a variable can't have this name, or null when it can. Names may not be units, so `2in` never means a variable. */
export function cadVariableNameError(name: string): string | null {
  if (!kNamePattern.test(name)) return 'Start the name with a letter, then use letters, digits or _.';
  if (unitFor(name) !== undefined || name.toLowerCase() === 'm') return `${name} is a unit, so it can't be a variable name.`;
  return null;
}

/** The variable names an expression uses, whether or not they exist. */
export function cadExpressionNames(text: string): string[] {
  const words = tokenize(text.slice(0, 512), true).filter(token => token.kind === 'word' && unitFor(token.text) === undefined);
  return [...new Set(words.map(token => variableName((token as { text: string }).text)))].filter(name => kNamePattern.test(name));
}

/** The expression with one variable renamed, leaving everything else as typed. */
export function renameCadExpressionVariable(text: string, from: string, to: string): string {
  return text.replace(new RegExp(`(?<![A-Za-z0-9_#])(#?)${from}(?![A-Za-z0-9_])`, 'g'), `$1${to}`);
}

/** A bounded arithmetic parser, with no eval, function calls or application-state access. Variables come only from the scope given. */
export function parseCadValue(
  text: string,
  { unit = 'mm', variables = {} }: { unit?: CadValueUnit; variables?: CadValueScope } = {}
): CadValueResult {
  const original = text.trim();
  if (!original) return { error: 'Enter a value.' };
  if (original.length > 512) return { error: 'This expression is too long.' };
  try {
    if (/,\d{3}(?!\d)/.test(original)) throw new Error('Ambiguous comma group: use a decimal point or remove thousands separators.');
    const source = original.replace(/^=/, '').replaceAll(',', '.').replaceAll('−', '-').replaceAll('×', '*').replaceAll('÷', '/');
    const tokens = tokenize(source);
    let index = 0;
    const expectedDimension = unit === 'scalar' ? null : unit === 'mm' ? 'length' : 'angle';
    const operator = (text: string, offset = 0) => {
      const token = tokens[index + offset];
      return token?.kind === 'operator' && token.text === text;
    };
    const applyUnit = (quantity: Quantity): Quantity => {
      const token = tokens[index];
      if (token?.kind !== 'word') return quantity;
      // M is an ambiguous magnitude prefix; keep requiring explicit lowercase m for metres.
      const conversion = unitFor(token.text);
      if (!conversion && Object.hasOwn(variables, variableName(token.text)))
        throw new Error(`Put * between the number and ${variableName(token.text)}.`);
      if (unit === 'scalar') throw new Error('Use a unitless value; length and angle units are not accepted.');
      if (!conversion) throw new Error(`Unknown unit: ${token.text}.`);
      if (conversion.dimension !== expectedDimension)
        throw new Error(unit === 'mm' ? 'Use length units: mm, cm, m, in, inch or ft.' : 'Use angle units: deg or rad.');
      if (quantity.dimension) throw new Error('This value already has a unit.');
      index++;
      return {
        ...quantity,
        value: checked(quantity.value * conversion.factor),
        dimension: conversion.dimension,
        explicitUnits: true,
        typedUnit: true,
      };
    };
    const primary = (depth: number): Quantity => {
      if (depth > 32) throw new Error('Too many nested parentheses or signs.');
      if (operator('+') || operator('-')) {
        const negative = operator('-');
        index++;
        const result = primary(depth + 1);
        return { ...result, value: negative ? -result.value : result.value };
      }
      if (operator('(')) {
        index++;
        const result = sum(depth + 1);
        if (!operator(')')) throw new Error('Close the parentheses.');
        index++;
        return applyUnit(result);
      }
      const token = tokens[index];
      if (token?.kind === 'word' && unitFor(token.text) === undefined) {
        const name = variableName(token.text);
        if (!Object.hasOwn(variables, name)) throw new Error(`There's no variable called ${name}.`);
        const variable = variables[name]!;
        index++;
        const dimension = variable.kind === 'number' ? null : variable.kind;
        return applyUnit({
          value: checked(variable.value),
          dimension,
          explicitUnits: dimension !== null,
          typedUnit: false,
          fraction: false,
        });
      }
      if (token?.kind !== 'number') throw new Error('Enter a number or a parenthesized expression.');
      index++;
      let value = token.value;
      let fraction = false;
      // Fractional unit literals use the entire fraction: 1/2in is half an inch,
      // while explicit 1/(2in) remains division by a length and is rejected below.
      const denominator = tokens[index + 1],
        suffix = tokens[index + 2];
      if (operator('/') && denominator?.kind === 'number' && suffix?.kind === 'word' && unitFor(suffix.text)) {
        if (denominator.value === 0) throw new Error('Cannot divide by zero.');
        value = checked(value / denominator.value);
        fraction = true;
        index += 2;
      }
      return applyUnit({ value, dimension: null, explicitUnits: false, typedUnit: false, fraction });
    };
    const product = (depth: number): Quantity => {
      let left = primary(depth);
      while (operator('*') || operator('/')) {
        const divide = operator('/');
        index++;
        const right = primary(depth);
        if (divide && right.value === 0) throw new Error('Cannot divide by zero.');
        if ((!divide && left.dimension && right.dimension) || (divide && right.dimension && left.dimension !== right.dimension))
          throw new Error('The expression must produce a length or angle, not compound units.');
        const result = checked(divide ? left.value / right.value : left.value * right.value);
        if (result === 0 && left.value !== 0 && right.value !== 0) throw new Error('The result is too small to represent.');
        left = {
          value: result,
          dimension: divide && right.dimension ? null : (left.dimension ?? right.dimension),
          explicitUnits: left.explicitUnits || right.explicitUnits,
          typedUnit: left.typedUnit || right.typedUnit,
          fraction: left.fraction || right.fraction || divide,
        };
      }
      return left;
    };
    const sum = (depth: number): Quantity => {
      let left = product(depth);
      while (operator('+') || operator('-')) {
        const subtract = operator('-');
        index++;
        let right = product(depth);
        // A plain number added to a variable is in that variable's base unit: `depth + 10` is 10 mm more, wherever it's
        // typed. With a typed unit, as in `2 + 1in`, the plain number stays ambiguous and still needs its own.
        const plain = (q: Quantity) => !q.dimension && !q.explicitUnits && !q.fraction;
        const named = (q: Quantity) => q.dimension !== null && !q.typedUnit;
        if (plain(left) && named(right)) left = { ...left, dimension: right.dimension };
        if (plain(right) && named(left)) right = { ...right, dimension: left.dimension };
        if (left.dimension !== right.dimension && (left.fraction || right.fraction))
          throw new Error('Put units on each fraction, or put the whole sum in parentheses before its unit.');
        if ((!left.dimension && left.explicitUnits && right.dimension) || (!right.dimension && right.explicitUnits && left.dimension))
          throw new Error('A unitless ratio cannot be added to a length or angle.');
        if (left.dimension !== right.dimension)
          throw new Error('Put units on each added value, or put the whole sum in parentheses before its unit.');
        left = {
          value: checked(left.value + (subtract ? -right.value : right.value)),
          dimension: left.dimension ?? right.dimension,
          explicitUnits: left.explicitUnits || right.explicitUnits,
          typedUnit: left.typedUnit || right.typedUnit,
          fraction: left.fraction || right.fraction,
        };
      }
      return left;
    };
    const result = sum(0);
    if (index !== tokens.length) throw new Error('Separate values with an operator and check the parentheses.');
    if (result.explicitUnits && result.dimension !== expectedDimension)
      throw new Error(
        unit === 'mm'
          ? 'The expression must produce a length, not a unitless ratio.'
          : 'The expression must produce an angle, not a unitless ratio.'
      );
    if (Math.abs(result.value) > CAD_MAX_INPUT_MAGNITUDE)
      throw new Error(
        `Use an absolute value of at most ${CAD_MAX_INPUT_MAGNITUDE}${unit === 'mm' ? ' mm' : unit === 'deg' ? ' degrees' : ''}.`
      );
    const baseUnitLiteral = unit !== 'scalar' && isBareBaseUnitLiteral(original, unit, result.value);
    return { value: checked(result.value), ...(!plainNumber.test(original) && !baseUnitLiteral && { expression: original }) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Enter a valid arithmetic expression.' };
  }
}

const trimDecimal = (text: string) => (text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text);

/** Display only: edit controls must retain String(value), not this rounded label. */
export function formatCadValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const [mantissa, exponent] = (Math.abs(value) >= 0.001 ? value.toFixed(3) : value.toPrecision(3)).split('e');
  return trimDecimal(mantissa!) + (exponent === undefined ? '' : `e${Number(exponent)}`);
}

// Only inspect display branches. Conditions and identifiers must keep their protocol/data values.
const technicalUnits = new Set(['mm', 'cm', 'deg', 'rad', 'in', 'ft']);
export function untranslatedDisplayText(node) {
  if (!node) return [];
  if (node.type === 'StringLiteral') return /[a-zA-Z]{2}/.test(node.value) && !technicalUnits.has(node.value) ? [node.value] : [];
  if (node.type === 'ConditionalExpression') return [...untranslatedDisplayText(node.consequent), ...untranslatedDisplayText(node.alternate)];
  if (node.type === 'TemplateLiteral') return [
    ...node.quasis.map(part => part.value.cooked ?? '').filter(text => /[a-zA-Z]{2}/.test(text) && !technicalUnits.has(text.trim())),
    ...node.expressions.flatMap(untranslatedDisplayText),
  ];
  // Calls, member access and other expressions supply data or already-localized values.
  return [];
}

import { describe, expect, it } from 'vitest';
import { parseSvgSketch } from './parse';
import { withoutSvgXmlDeclaration } from './xmlDeclaration';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="10mm"><rect width="20" height="10"/></svg>';

describe('bounded SVG XML declaration handling', () => {
  it.each([
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>",
    '<?xml\tversion = "1.1"\r\nstandalone="no"?>',
    '\ufeff<?xml version="1.0"?>',
  ])('accepts a valid initial declaration: %s', declaration => {
    expect(withoutSvgXmlDeclaration(declaration + svg)).toBe(svg);
    expect(parseSvgSketch(declaration + svg).contours).toHaveLength(1);
  });

  it('accepts a long valid whitespace run without passing the declaration to the XML parser', () => {
    const declaration = '<?xml ' + ' '.repeat(800_000) + 'version="1.0" encoding="UTF-8"?>';
    expect(withoutSvgXmlDeclaration(declaration + svg)).toBe(svg);
    expect(parseSvgSketch(declaration + svg).contours).toHaveLength(1);
  });

  it('rejects adversarial incomplete whitespace and quoted-value runs by syntax, without timing assertions', () => {
    for (const declaration of [
      '<?xml ' + ' '.repeat(800_000),
      '<?xml ' + ' '.repeat(800_000) + '?>',
      '<?xml version="1.0" encoding="' + 'A'.repeat(800_000),
    ])
      expect(() => parseSvgSketch(declaration)).toThrow(/Invalid initial SVG XML declaration/);
  });

  it.each([
    '<?xml?>',
    '<?xml version="1.0">',
    '<?xml version="1.0"',
    '<?xml version=1.0?>',
    '<?xml encoding="UTF-8"?>',
    '<?xml version="2.0"?>',
    '<?xml version="1.0" encoding=""?>',
    '<?xml version="1.0" encoding="UTF 8"?>',
    '<?xml version="1.0"encoding="UTF-8"?>',
    '<?xml version="1.0" standalone="maybe"?>',
    '<?xml version="1.0" standalone="yes" encoding="UTF-8"?>',
    '<?xml version="1.0" version="1.0"?>',
    '<?xml version="1.0" extra="x"?>',
  ])('rejects malformed or unsupported declarations: %s', declaration => {
    expect(() => parseSvgSketch(declaration + svg)).toThrow(/Invalid initial SVG XML declaration/);
  });

  it.each([
    ' <?xml version="1.0"?>',
    '<?XML version="1.0"?>',
    '<?xml-stylesheet href="https://example.org/style.css"?>',
    '<?xml version="1.0"?><?other value?>',
    '<?xml version="1.0"?><?xml version="1.0"?>',
    '<!DOCTYPE svg>',
    '<!ENTITY x "value">',
    '<?xml version="1.0"?><!DOCTYPE svg>',
  ])('keeps other PIs, misplaced declarations and DTDs forbidden: %s', prefix => {
    expect(() => parseSvgSketch(prefix + svg)).toThrow();
  });

  it('does not bypass external-resource refusal after a valid header', () => {
    expect(() =>
      parseSvgSketch(
        '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.org/x.svg"/></svg>'
      )
    ).toThrow(/unsupported/i);
  });
});

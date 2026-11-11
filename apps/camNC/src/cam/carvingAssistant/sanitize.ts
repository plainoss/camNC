const namespace = 'http://www.w3.org/2000/svg';
const elements = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line']);
const geometry = new Set(['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'stroke-width']);
const numeric = /^[\s,0-9eE+.-]+$/;
const finiteCoordinates = (value: string) =>
  (value.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).every(
    token => Number.isFinite(Number(token)) && Math.abs(Number(token)) <= 1e6
  );

/** Rebuild a small drawing vocabulary; never insert provider markup into the live DOM. */
export function sanitizeCarvingSvg(source: string): string {
  if (source.length > 120_000 || /<!|<\?/.test(source))
    throw new Error('Artwork must be a small, self-contained SVG without declarations.');
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') throw new Error('Artwork is not valid SVG.');
  const root = parsed.documentElement;
  const viewBox = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0)
    throw new Error('Artwork needs a finite positive SVG viewBox.');
  if (Math.max(viewBox[2] / viewBox[3], viewBox[3] / viewBox[2]) > 20)
    throw new Error('Artwork proportions exceed the supported 20:1 limit.');
  const output = document.implementation.createDocument(namespace, 'svg', null);
  let count = 0;
  let commands = 0;
  const copy = (node: Element, depth: number): Element => {
    if (++count > 300 || depth > 12) throw new Error('Artwork has too many shapes or nested groups.');
    if (!elements.has(node.localName) || (node.namespaceURI && node.namespaceURI !== namespace) || (depth && node.localName === 'svg'))
      throw new Error(`Unsupported artwork element: ${node.localName}. Use plain filled shapes.`);
    const target = output.createElementNS(namespace, node.localName);
    for (const attribute of [...node.attributes]) {
      const { name, value } = attribute;
      if (name === 'xmlns' && depth === 0 && value === namespace) continue;
      if (name === 'viewBox' && depth === 0) continue;
      // The viewBox is the sole viewport; external links, styles, filters and animation are rejected, never evaluated.
      if (geometry.has(name)) {
        if (
          !numeric.test(value) ||
          !value.trim() ||
          !value
            .trim()
            .split(/[\s,]+/)
            .every(v => Number.isFinite(Number(v)) && Math.abs(Number(v)) <= 1e6)
        )
          throw new Error(`Invalid artwork coordinate: ${name}.`);
        if (depth === 0 && (name === 'width' || name === 'height')) continue;
      } else if (name === 'd' && node.localName === 'path') {
        if (!/^[MmLlHhVvCcSsQqTtAaZz\s,0-9eE+.-]*$/.test(value) || !finiteCoordinates(value)) throw new Error('Invalid artwork path.');
        commands += (value.match(/[MmLlHhVvCcSsQqTtAaZz]/g) ?? []).length;
        if (commands > 2500) throw new Error('Artwork has too many path commands.');
      } else if (name === 'points' && (node.localName === 'polygon' || node.localName === 'polyline')) {
        if (!numeric.test(value) || !finiteCoordinates(value)) throw new Error('Invalid artwork points.');
        commands += value.trim().split(/[\s,]+/).length / 2;
        if (commands > 2500) throw new Error('Artwork has too many points.');
      } else if (name === 'fill' || name === 'stroke') {
        if (!/^(?:black|white|none|#000(?:000)?|#fff(?:fff)?)$/i.test(value)) throw new Error('Use only black, white or no fill/stroke.');
      } else if (name === 'fill-rule') {
        if (value !== 'evenodd' && value !== 'nonzero') throw new Error('Invalid artwork fill rule.');
      } else if (name === 'stroke-linecap') {
        if (!['round', 'butt', 'square'].includes(value)) throw new Error('Invalid line cap.');
      } else if (name === 'stroke-linejoin') {
        if (!['round', 'bevel', 'miter'].includes(value)) throw new Error('Invalid line join.');
      } else if (name === 'transform') {
        // Split at closing parentheses so adjacent whitespace cannot cause exponential regex backtracking.
        const transforms = value.split(')');
        const trailing = transforms.pop();
        if (
          trailing?.trim() !== '' ||
          transforms.length === 0 ||
          !transforms.every(part => /^\s*(?:translate|scale|rotate|matrix|skewX|skewY)\([\s,0-9eE+.-]+$/.test(part)) ||
          !finiteCoordinates(value)
        )
          throw new Error('Invalid artwork transform.');
      } else throw new Error(`Unsupported artwork attribute: ${name}.`);
      target.setAttribute(name, value);
    }
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.ELEMENT_NODE) target.append(copy(child as Element, depth + 1));
      else if (child.nodeType !== Node.COMMENT_NODE && child.textContent?.trim()) throw new Error('Convert artwork text to filled paths.');
    }
    return target;
  };
  const safe = copy(root, 0);
  safe.setAttribute('viewBox', viewBox.join(' '));
  safe.setAttribute('xmlns', namespace);
  return new XMLSerializer().serializeToString(safe);
}

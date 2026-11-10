// CSS named colors are fixed data; alpha-bearing and context-dependent paints are
// excluded because invisible geometry must never become imported material.
const namedColors = new Set(
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(
    ' '
  )
);
export function isOpaqueSvgPaint(source: string): boolean {
  if (source === 'none' || namedColors.has(source) || /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/.test(source)) return true;
  const rgb = /^rgb\((.*)\)$/.exec(source);
  if (!rgb) return false;
  const comma = rgb[1].includes(','),
    parts = comma ? rgb[1].split(',').map(s => s.trim()) : rgb[1].trim().split(/\s+/);
  if (
    parts.length !== 3 ||
    !parts.every(p => /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%?$/.test(p) && Number.isFinite(Number.parseFloat(p)))
  )
    return false;
  return !comma || parts.every(p => p.endsWith('%') === parts[0].endsWith('%'));
}

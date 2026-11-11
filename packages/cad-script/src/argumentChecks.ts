import { fail } from './editExisting';
import type { DesignEdit } from './editTypes';

const length = (value: unknown, label: string) => {
  if (!(typeof value === 'number' && Number.isFinite(value)) && !(typeof value === 'string' && value.trim()))
    fail(`${label} must be a finite number or a non-empty expression.`);
};
const text = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-empty string.`);
};
const tuple = (value: unknown, count: number, label: string) => {
  if (!Array.isArray(value) || value.length !== count) return fail(`${label} must contain ${count} coordinates.`);
  value.forEach((item, index) => length(item, `${label}[${index}]`));
};
const options = (value: unknown, method: string, keys: readonly string[], required: readonly string[] = []) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail(`${method} needs an options object. Available options: ${keys.join(', ')}.`);
  for (const key of Object.keys(value))
    if (!keys.includes(key)) fail(`${method} has no option ${key}. Available options: ${keys.join(', ')}.`);
  for (const key of required) if (!(key in value)) fail(`${method} requires ${key}. Available options: ${keys.join(', ')}.`);
  return value as Record<string, unknown>;
};

const selection = (value: unknown, method: string) => {
  if (!Array.isArray(value) || !value.length) return fail(`${method} needs a nonempty array of sketch references.`);
  const reference = (ref: unknown) => {
    if (!ref || typeof ref !== 'object' || !('id' in ref) || typeof ref.id !== 'string' || !ref.id.trim())
      fail(`${method} needs sketch references with an id.`);
  };
  value.forEach(item => {
    if (item && typeof item === 'object' && 'edges' in item) {
      const edges = item.edges;
      if (!edges || typeof edges !== 'object') return fail(`${method} needs an edges array or record.`);
      const entries = Array.isArray(edges) ? edges : Object.values(edges);
      if (!entries.length) return fail(`${method} needs at least one edge.`);
      entries.forEach(reference);
    } else reference(item);
  });
};

function check(method: string, args: unknown[]) {
  const [first, second] = args;
  if (
    method === 'part' ||
    method === 'newPart' ||
    method === 'existingCopy' ||
    method === 'step' ||
    method === 'existingCut' ||
    method === 'sketch' ||
    method === 'find'
  )
    text(first, method);
  if ((method === 'part' || method === 'newPart') && second !== undefined) {
    const value = options(second, method, ['thickness', 'relief']);
    for (const key of ['thickness', 'relief']) if (value[key] !== undefined) length(value[key], `${method}.${key}`);
  }
  if (method === 'variable') {
    text(first, 'Variable name');
    text(second, 'Variable expression');
  }
  if (method === 'thickness' || method === 'value' || method === 'depth' || method === 'radius')
    length(method === 'radius' ? second : first, method);
  if (method === 'relief' && first !== null) length(first, method);
  if (method === 'rect') {
    const value = options(first, method, ['w', 'h', 'at', 'center'], ['w', 'h']);
    length(value.w, 'rect.w');
    length(value.h, 'rect.h');
    if (value.at !== undefined) tuple(value.at, 2, 'rect.at');
    if (value.center !== undefined) tuple(value.center, 2, 'rect.center');
  }
  if (method === 'circle') {
    const value = options(first, method, ['at', 'd'], ['at', 'd']);
    tuple(value.at, 2, 'circle.at');
    length(value.d, 'circle.d');
  }
  if (method === 'bezier' || method === 'spline') {
    const value = options(first, method, method === 'spline' ? ['points', 'closed'] : ['points'], ['points']);
    if (!Array.isArray(value.points)) return fail(`${method}.points must be an array of coordinates.`);
    value.points.forEach(point => tuple(point, 2, `${method} point`));
    if (value.closed !== undefined && typeof value.closed !== 'boolean') fail('spline.closed must be true or false.');
  }
  if (method === 'ellipse') {
    const value = options(first, method, ['at', 'rx', 'ry', 'angle'], ['at', 'rx', 'ry']);
    tuple(value.at, 2, 'ellipse.at');
    for (const key of ['rx', 'ry', 'angle']) if (value[key] !== undefined) length(value[key], `ellipse.${key}`);
  }
  if (method === 'fitBounds') {
    selection(first, method);
    const value = options(second, method, ['w', 'h', 'at', 'preserveAspect'], ['w', 'h', 'preserveAspect']);
    length(value.w, 'fitBounds.w');
    length(value.h, 'fitBounds.h');
    if (value.at !== undefined) tuple(value.at, 2, 'fitBounds.at');
    if (typeof value.preserveAspect !== 'boolean') fail('fitBounds.preserveAspect must explicitly be true or false.');
  }
  if (method === 'offset') {
    selection(first, method);
    const value = options(second, method, ['distance', 'wholeLoop'], ['distance']);
    length(value.distance, 'offset.distance');
    if (value.wholeLoop !== undefined && typeof value.wholeLoop !== 'boolean') fail('offset.wholeLoop must be true or false.');
  }
  if (method === 'cubicTo' || method === 'quadTo') {
    tuple(first, 2, method);
    const keys = method === 'cubicTo' ? ['control1', 'control2'] : ['control'];
    const value = options(second, method, keys, keys);
    keys.forEach(key => tuple(value[key], 2, `${method}.${key}`));
  }
  if (method === 'arc') {
    const value = options(first, method, ['at', 'r', 'from', 'to'], ['at', 'r', 'from', 'to']);
    tuple(value.at, 2, 'arc.at');
    for (const key of ['r', 'from', 'to'])
      if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) fail(`arc.${key} must be a finite number.`);
  }
  if (method === 'cut') {
    const value = options(second, method, ['depth'], ['depth']);
    if (value.depth !== 'through') length(value.depth, 'cut.depth');
  }
  if ((method === 'place' && first && typeof first === 'object' && 'at' in first) || method === 'copy') {
    const value = options(first, method, method === 'copy' ? ['at', 'x', 'y', 'mirrored', 'name'] : ['at', 'x', 'y'], ['at']);
    tuple(value.at, 3, `${method}.at`);
  } else if (method === 'place') tuple(second, 2, 'place coordinates');
  if (method === 'drawOn' && second !== undefined) options(second, method, ['offset', 'inward']);
  if (method === 'cutParts') {
    const value = options(second, method, ['with', 'clearance', 'split'], ['with']);
    if (value.clearance !== undefined) length(value.clearance, 'cutParts.clearance');
    if (value.split !== undefined && value.split !== 'half') {
      const split = options(value.split, 'cutParts.split', ['fingers'], ['fingers']);
      length(split.fingers, 'cutParts.split.fingers');
    }
  }
  if (method === 'expect') {
    const value = options(first, method, ['size', 'thickness', 'holes', 'notches', 'pockets', 'depths', 'freedom', 'tolerance']);
    if (value.size !== undefined) tuple(value.size, 2, 'expect.size');
    if (value.thickness !== undefined) length(value.thickness, 'expect.thickness');
    if (value.depths !== undefined) {
      if (!Array.isArray(value.depths)) return fail('expect.depths must be an array.');
      value.depths.forEach(depth => length(depth, 'expect.depths'));
    }
    for (const key of ['holes', 'notches', 'pockets', 'freedom', 'tolerance'])
      if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isFinite(value[key])))
        fail(`expect.${key} must be a finite number.`);
  }
  if (method === 'sketchOn' && first !== 'top' && first !== 'underside') {
    const value = options(first, method, ['floorOf'], ['floorOf']);
    if (!value.floorOf || typeof value.floorOf !== 'object' || !('id' in value.floorOf) || typeof value.floorOf.id !== 'string')
      fail('sketchOn.floorOf must be an existing cut reference.');
  }
  if (method === 'polygon') {
    if (!Array.isArray(first) || first.length < 3) return fail('A polygon needs at least 3 points.');
    first.forEach(point => tuple(point, 2, 'polygon point'));
  }
  if (method === 'distance') length(args[2], 'distance');
  if (method === 'fillet') length(second, 'fillet radius');
  if (method === 'pattern') {
    if (second === undefined) {
      const value = options(first, method, ['axis', 'count', 'spacing'], ['axis', 'count', 'spacing']);
      length(value.count, 'pattern.count');
      length(value.spacing, 'pattern.spacing');
      if (!['x', 'y', 'z'].includes(String(value.axis))) fail('pattern.axis must be x, y or z.');
    } else {
      const value = options(second, method, ['count', 'step', 'rows'], ['count', 'step']);
      tuple(value.step, 2, 'pattern.step');
      length(value.count, 'pattern.count');
      if (value.rows !== undefined) {
        const row = options(value.rows, 'pattern.rows', ['count', 'step'], ['count', 'step']);
        tuple(row.step, 2, 'pattern.rows.step');
        length(row.count, 'pattern.rows.count');
      }
    }
  }
  if (method === 'path' || method === 'lineTo') tuple(first, 2, method);
  if (method === 'line') {
    tuple(first, 2, 'line start');
    tuple(second, 2, 'line end');
  }
  if (method === 'arcTo') {
    tuple(first, 2, method);
    options(second, method, ['r', 'clockwise', 'large', 'tangent']);
  }
  if (method === 'close' && first !== undefined) options(first, method, ['straight']);
  if (method === 'regionAt' && (args.length !== 2 || args.some(value => typeof value !== 'number' || !Number.isFinite(value))))
    fail('regionAt needs finite x and y coordinates.');
}

/** Browser scripts have no TypeScript pass. Check options before helpers can dereference a misspelled field. */
export function checkedDesignApi(design: DesignEdit): DesignEdit {
  const cache = new WeakMap<object, object>();
  const wrap = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(item => wrap(item));
    const previous = cache.get(value);
    if (previous) return previous;
    const proxy = new Proxy(value, {
      get(target, key, receiver) {
        if (typeof key === 'symbol') return Reflect.get(target, key, receiver);
        if (!(key in target)) return fail(`There is no method or property ${key}. Available: ${Object.keys(target).join(', ')}.`);
        const item = Reflect.get(target, key, receiver);
        if (typeof item !== 'function') return wrap(item);
        return (...args: unknown[]) => {
          check(key, args);
          if (key === 'folder' || key === 'existingFolder') {
            text(args[0], key);
            const callback = args[1];
            if (typeof callback !== 'function') return fail(`${key} needs a script callback.`);
            args[1] = (scoped: DesignEdit) => callback(checkedDesignApi(scoped));
          }
          return wrap(item.apply(target, args));
        };
      },
    });
    cache.set(value, proxy);
    return proxy;
  };
  return wrap(design) as DesignEdit;
}

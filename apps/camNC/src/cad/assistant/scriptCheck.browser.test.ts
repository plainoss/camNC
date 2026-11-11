import { describe, expect, it } from 'vitest';
import { createCadDocument } from '@wbcnc/cad';
import { editCad } from '../../../../../packages/cad-script/src/edit';
import plate from '../../../../../packages/cad-script/examples/plate.cad';
import bracket from '../../../../../packages/cad-script/examples/bracket.cad';
import side from '../../../../../packages/cad-script/examples/shelf-side.cad';
import tray from '../../../../../packages/cad-script/examples/tray.cad';
import { cupboard } from '../../../../../packages/cad-script/examples/cupboard.cad';
import cupboardSource from '../../../../../packages/cad-script/examples/cupboard.cad.ts?raw';
import { sandboxFrameHtml } from './sandboxFrame';
import { checkScriptInBrowser } from './scriptCheck';

const source = `d=>{const part=d.newPart('Panel',{thickness:18});part.profile.rect({at:[0,0],w:100,h:80});part.expect({size:[100,80],freedom:0});}`;

describe('isolated browser design checks', () => {
  it.each([
    ['plate', plate],
    ['bracket', bracket],
    ['shelf-side', side],
    ['tray', tray],
  ] as const)(
    'matches the command-line API report for %s',
    async (_name, script) => {
      const start = createCadDocument();
      const expected = await editCad(start, script);
      const actual = await checkScriptInBrowser(start, script.toString());
      const sizes = (result: typeof expected) =>
        result.report.parts.map(part => ({
          name: part.name,
          thickness: part.thickness,
          outline: part.outline,
          holes: part.holes,
          notches: part.notches,
          cam: part.cam,
          toolpaths: part.toolpaths,
          cuts: part.cuts.map(({ ref: _ref, ...cut }) => cut),
          sketches: part.sketches.map(sketch => ({
            freedom: sketch.freedom,
            status: sketch.status,
            constraints: sketch.constraints,
            entities: sketch.entities.map(({ ref: _ref, ...entity }) => {
              const { ends: _ends, ...rest } = entity as typeof entity & { ends?: string[] };
              return rest;
            }),
          })),
        }));
      expect(actual.scriptError).toBeUndefined();
      expect(actual.ok).toBe(expected.ok);
      expect(sizes(actual)).toEqual(sizes(expected));
      expect(actual.report.errors).toEqual(expected.report.errors);
      expect(actual.report.warnings).toEqual(expected.report.warnings);
    },
    45_000
  );
  it('imports the furniture patterns, whose measured construction checks pass', async () => {
    const result = await checkScriptInBrowser(
      createCadDocument(),
      `import { design, frameStool, panelChair } from '@wbcnc/cad-script';\nexport default design(d => { frameStool()(d); panelChair({ name: 'Chair', at: [500, 0, 0] })(d); });`
    );
    expect(result.scriptError).toBeUndefined();
    expect(result.report.errors).toEqual([]);
    expect(result.document.constructions?.map(plan => plan.recipe).sort()).toEqual(['frame-stool-glued-v1', 'panel-chair-keyed-v1']);
  }, 180_000);

  it('checks the literal cupboard example returned by the assistant tool', async () => {
    const result = await checkScriptInBrowser(createCadDocument(), cupboardSource);
    expect(result.scriptError).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.document.folders).toHaveLength(1);
  }, 45_000);
  it('matches the cupboard factory report', async () => {
    const start = createCadDocument();
    const expected = await editCad(start, cupboard());
    const actual = await checkScriptInBrowser(start, `(${cupboard.toString()})()`);
    expect(actual.scriptError).toBeUndefined();
    expect(actual.ok).toBe(true);
    expect(actual.report.parts.map(part => ({ name: part.name, size: part.outline?.size, cuts: part.cuts.length, cam: part.cam }))).toEqual(
      expected.report.parts.map(part => ({ name: part.name, size: part.outline?.size, cuts: part.cuts.length, cam: part.cam }))
    );
  }, 45_000);
  it('enforces CSP and opaque-origin storage even without API overrides', async () => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.srcdoc = sandboxFrameHtml;
    frame.hidden = true;
    const channel = new MessageChannel();
    const runtime = `self.addEventListener('message',async event=>{
      const port=event.ports[0];
      const violation=new Promise(resolve=>self.addEventListener('securitypolicyviolation',event=>resolve(event.effectiveDirective),{once:true}));
      let network=false,storage=false;
      try{await fetch('https://example.com/cad-sandbox-test');}catch{network=true;}
      try{indexedDB.open('app-credentials');}catch(error){storage=error.name === 'SecurityError';}
      port.postMessage({network,storage,directive:await violation,parentType:typeof parent});
    });`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('The sandbox did not report a CSP violation.')), 8000);
        channel.port1.onmessage = event => {
          if (event.data.type === 'ready') channel.port1.postMessage({ type: 'check', runtime, document: {}, source: '' });
          if (event.data.type === 'result') resolve(event.data.result);
          if (event.data.type === 'failed') reject(new Error(event.data.message));
        };
        frame.onload = () => frame.contentWindow!.postMessage({ type: 'connect' }, '*', [channel.port2]);
        document.body.append(frame);
      });
      expect(result).toEqual({ network: true, storage: true, directive: 'connect-src', parentType: 'undefined' });
    } finally {
      if (timer) clearTimeout(timer);
      channel.port1.close();
      frame.remove();
    }
  }, 10_000);
  it('ignores forged global worker replies', async () => {
    const result = await checkScriptInBrowser(
      createCadDocument(),
      `d=>{postMessage({ok:true,report:{ok:true},document:{parts:[{name:'Forged'}]}});}`
    );
    expect(result.ok).toBe(false);
    expect(result.document.parts).toEqual([]);
    expect(result.report.errors.some(error => error.code === 'no-parts')).toBe(true);
  }, 45_000);
  it('cannot read or navigate the parent window', async () => {
    const result = await checkScriptInBrowser(createCadDocument(), `d=>{parent.location.href='https://example.com/escape';}`);
    expect(result.ok).toBe(false);
    expect(result.scriptError).toContain('parent is not defined');
  }, 45_000);

  it('checks an ordinary design under cross-origin isolation', async () => {
    expect(crossOriginIsolated).toBe(true);
    const start = createCadDocument('Sandbox');
    const result = await checkScriptInBrowser(start, source);
    expect(result.scriptError).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.document.id).toBe(start.id);
    expect(start.parts).toEqual([]);
    expect(result.report.parts[0]).toMatchObject({ name: 'Panel', outline: { size: [100, 80] } });
  }, 45_000);
  it('runs native script modules while CSP blocks JavaScript string evaluation', async () => {
    const result = await checkScriptInBrowser(
      createCadDocument(),
      `d=>{
      let blocked=false;
      try{new Function('return 42')();}catch(error){blocked=error.name==='EvalError';}
      if(!blocked)throw new Error('String evaluation must stay disabled.');
      (${source})(d);
    }`
    );
    expect(result.scriptError).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.report.parts[0]).toMatchObject({ name: 'Panel', outline: { size: [100, 80] } });
  }, 45_000);
  it.each(['fetch', 'localStorage', 'indexedDB', 'WebSocket'])(
    'refuses %s',
    async name => {
      const start = createCadDocument();
      const result = await checkScriptInBrowser(start, `d=>{globalThis[${JSON.stringify(name)}];}`);
      expect(result.ok).toBe(false);
      expect(result.scriptError).toContain(name);
      expect(result.document).toEqual(start);
    },
    45_000
  );
  it('reports misspelled options with the supported name', async () => {
    const result = await checkScriptInBrowser(createCadDocument(), `d=>{d.newPart('Panel').profile.circle({at:[20,20],radius:5});}`);
    expect(result.scriptError).toMatch(/circle has no option radius.*\bd\b/);
  }, 45_000);
  it('terminates an infinite loop without blocking the page', async () => {
    const started = performance.now();
    const result = await checkScriptInBrowser(createCadDocument(), 'd=>{while(true){}}', { timeoutMs: 500 });
    expect(result.ok).toBe(false);
    expect(result.scriptError).toContain('exceeded');
    expect(performance.now() - started).toBeLessThan(5000);
  }, 10_000);
  it('stops a running worker on user cancellation', async () => {
    const controller = new AbortController();
    const pending = checkScriptInBrowser(createCadDocument(), 'd=>{while(true){}}', { signal: controller.signal });
    controller.abort();
    expect((await pending).scriptError).toContain('stopped');
  });
});

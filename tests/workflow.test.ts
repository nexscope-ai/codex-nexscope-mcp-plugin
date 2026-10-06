import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextEncoder } from 'node:util';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync(resolve(process.cwd(), 'ui/workflow/v1.html'), 'utf8');
const origin = 'https://host.example';
let dom: JSDOM | undefined;
function mount(capabilities: object = { serverTools: {} }, shortTimeout = false) {
  const sent = vi.fn();
  dom = new JSDOM(html, {
    url: 'https://assets.nexscope.ai/mcp-apps/workflow/v1.html',
    runScripts: 'dangerously',
    beforeParse(window) {
      window.TextEncoder = TextEncoder;
      window.postMessage = sent; window.confirm = () => { throw new Error('Host confirmation is unavailable'); };
      if (shortTimeout) {
        const original = window.setTimeout.bind(window);
        window.setTimeout = ((callback: TimerHandler, ms?: number) => original(callback, Math.min(ms ?? 0, 15))) as typeof window.setTimeout;
      }
      window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
      window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    },
  });
  const { window } = dom;
  const emit = (data: unknown, sender: MessageEventSource | null = window, sourceOrigin = origin) =>
    window.dispatchEvent(new window.MessageEvent('message', { data, source: sender, origin: sourceOrigin }));
  const initialize = async () => {
    emit({ jsonrpc: '2.0', id: 1, result: {
      protocolVersion: '2026-01-26', hostInfo: { name: 'test-host', version: '1' },
      hostCapabilities: capabilities, hostContext: { displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] },
    } });
    await Promise.resolve();
  };
  const open = (data: object) => emit({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { ok: true, data } } });
  const reply = async (data: object, isError = false) => {
    const request = sent.mock.calls.at(-1)?.[0];
    emit({ jsonrpc: '2.0', id: request.id, result: { structuredContent: isError ? { ok: false, error: data } : { ok: true, data }, isError } });
    await new Promise(resolve => setTimeout(resolve, 0));
  };
  return { window, sent, emit, initialize, open, reply };
}
afterEach(() => { dom?.window.close(); dom = undefined; });
const initial = { canvases: { items: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Saved research', revision: 2, updatedAt: '2026-10-01T00:00:00Z' }] }, catalog: { items: [{ toolName: 'nexscope_amazon_search', title: 'Amazon Search', summary: 'Find products', creditCost: null }], total: 1 }, limits: { nodes: 40, edges: 80 } };

describe('Research Canvas MCP App', () => {
  it('requires current discard consent before opening history over a dirty draft', async () => {
    const { window, sent, initialize, open, reply } = mount();
    await initialize();
    open({ ...initial, canvas: { id: initial.canvases.items[0].id, name: 'Draft', revision: 1, nodes: [], edges: [] } });
    const name = window.document.querySelector<HTMLInputElement>('#canvas-name')!;
    const rename = (value: string) => { name.value = value; name.dispatchEvent(new window.Event('input')); };
    rename('Unsaved draft');
    window.document.querySelector<HTMLButtonElement>('#history')!.click();
    const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await reply({ items: [{ runId, status: 'SUCCEEDED' }] });
    const history = window.document.querySelector<HTMLButtonElement>('#runs button')!;
    const calls = sent.mock.calls.length;
    history.click();
    expect(window.document.querySelector<HTMLDialogElement>('#confirm-edit')!.open).toBe(true);
    window.document.querySelector<HTMLButtonElement>('#confirm-cancel')!.click();
    await Promise.resolve();
    expect(name.value).toBe('Unsaved draft');
    expect(sent.mock.calls).toHaveLength(calls);
    history.click();
    rename('Newer unsaved draft');
    window.document.querySelector<HTMLButtonElement>('#confirm-accept')!.click();
    await Promise.resolve();
    expect(sent.mock.calls).toHaveLength(calls);
    expect(name.value).toBe('Newer unsaved draft');
    history.click();
    window.document.querySelector<HTMLButtonElement>('#confirm-accept')!.click();
    await Promise.resolve();
    expect(sent.mock.calls.at(-1)?.[0].params.arguments).toMatchObject({ action: 'status', runId, includeSnapshot: true });
    await reply({ runId, status: 'SUCCEEDED', steps: [], canvasSnapshot: {
      id: initial.canvases.items[0].id, name: 'Historical snapshot', revision: 1, nodes: [], edges: [],
    } });
    expect(name.value).toBe('Historical snapshot');
    expect(name.disabled).toBe(true);
  });

  it.each(['save', 'invalid port', 'edit during fetch', 'navigate during fetch', 'fetch failure'])(
    'loads bound skill schemas before saving a reopened draft: %s', async scenario => {
      const { window, sent, initialize, open, reply } = mount();
      await initialize();
      const inputId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', skillId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const canvas = { id: initial.canvases.items[0].id, name: 'Bound draft', revision: 1,
        nodes: [{ id: inputId, type: 'input', x: 0, y: 0, config: { value: 'lamps' } },
          { id: skillId, type: 'skill', x: 200, y: 0, config: { toolName: 'nexscope_amazon_search', args: {} } }],
        edges: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', from: inputId, fromPath: '', to: skillId,
          toPath: scenario === 'invalid port' ? '/args/notPublished' : '/args/keyword' }] };
      open({ ...initial, catalog: { items: [] }, canvas });
      const name = window.document.querySelector<HTMLInputElement>('#canvas-name')!;
      name.value = 'Renamed bound draft'; name.dispatchEvent(new window.Event('input'));
      window.document.querySelector<HTMLButtonElement>('#save')!.click();
      expect(sent.mock.calls.at(-1)?.[0].params.arguments).toMatchObject({ action: 'catalog', toolName: 'nexscope_amazon_search' });
      if (scenario === 'edit during fetch') {
        name.value = 'Still editing'; name.dispatchEvent(new window.Event('input'));
      }
      if (scenario === 'navigate during fetch') {
        window.document.querySelector<HTMLButtonElement>('#blank')!.click();
        window.document.querySelector<HTMLButtonElement>('#confirm-accept')!.click();
        await Promise.resolve();
      }
      if (scenario === 'fetch failure') await reply({ message: 'Catalog unavailable' }, true);
      else await reply({ item: { toolName: 'nexscope_amazon_search',
        inputSchema: { properties: { keyword: { type: 'string' } }, required: ['keyword'] } } });
      const saves = sent.mock.calls.filter(([request]) => request.method === 'tools/call' && request.params.arguments.action === 'save');
      if (scenario === 'save') {
        expect(saves).toHaveLength(1);
        const saved = saves[0][0].params.arguments.canvas;
        expect(saved.name).toBe('Renamed bound draft');
        expect(saved.edges).toEqual(canvas.edges);
        await reply({ canvas: { ...saved, revision: 2 } });
        expect(window.document.querySelector('#notice')?.textContent).toBe('Canvas saved.');
      } else {
        expect(saves).toHaveLength(0);
        if (scenario === 'invalid port') expect(window.document.querySelector('#notice')?.textContent).toContain('Choose an allowed input port');
        if (scenario === 'fetch failure') expect(window.document.querySelector('#notice')?.textContent).toContain('Catalog unavailable');
        if (scenario === 'edit during fetch') expect(name.value).toBe('Still editing');
        if (scenario === 'navigate during fetch') expect(window.document.querySelectorAll('.node')).toHaveLength(0);
      }
    });

  it('returns to visited table and variable JSON offsets and resets history across views, nodes and runs', async () => {
    const { window, sent, initialize, open, reply } = mount();
    await initialize();
    const nodeIds = ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
    const runData = { runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'SUCCEEDED', revision: 1,
      steps: nodeIds.map(id => ({ id, nodeType: 'output', status: 'SUCCEEDED' })),
      canvasSnapshot: { id: initial.canvases.items[0].id, name: 'Pages', revision: 1, edges: [],
        nodes: nodeIds.map(id => ({ id, type: 'output', x: 0, y: 0, config: { value: null, alias: id } })) } };
    const control = (text: string) => [...window.document.querySelectorAll<HTMLButtonElement>('#result button')]
      .find(button => button.textContent === text)!;
    const table = (offset: number, nextOffset?: number) => ({
      offset, nextOffset, columns: ['/title'], rows: [{ '/title': 'A readable product title' }], truncated: true,
    });
    open({ ...initial, run: runData });
    await reply(table(0, 10));
    expect(control('Previous results').disabled).toBe(true);
    const scroll = window.document.querySelector<HTMLElement>('.result-table-scroll')!;
    expect(scroll.tabIndex).toBe(0);
    expect(scroll.getAttribute('aria-label')).toContain('Scroll horizontally');
    expect(window.getComputedStyle(scroll).overflowX).toBe('auto');
    expect(window.getComputedStyle(scroll.querySelectorAll('td')[1]).minWidth).toBe('150px');
    window.document.querySelector<HTMLInputElement>('#result td input')!.click();
    control('Next results').click();
    expect(sent.mock.calls.at(-1)?.[0].params.arguments.offset).toBe(10);
    await reply(table(10));
    expect(window.document.querySelector('#export-scope option:last-child')?.textContent).toContain('(0)');
    expect(control('Next results').disabled).toBe(true);
    expect(window.document.querySelector('#result')?.textContent).toContain('preview omits fields');
    expect(window.document.querySelector('#result')?.textContent).not.toContain('More results are available');
    control('Previous results').click();
    expect(sent.mock.calls.at(-1)?.[0].params.arguments.offset).toBe(0);
    await reply(table(0, 10));
    control('Advanced data').click();
    await reply({ offset: 0, json: 'first', nextOffset: 7, truncated: false });
    expect(control('Previous results').disabled).toBe(true);
    expect(control('Next results').disabled).toBe(false);
    expect(window.document.querySelector('#result')?.textContent).toContain('More results are available');
    control('Next results').click();
    await reply({ offset: 7, json: 'second', nextOffset: 19, truncated: true });
    control('Next results').click();
    await reply({ offset: 19, json: 'last' });
    control('Previous results').click();
    expect(sent.mock.calls.at(-1)?.[0].params.arguments).toMatchObject({ view: 'json', offset: 7 });
    await reply({ offset: 7, json: 'second', nextOffset: 19 });
    control('Previous results').click();
    await reply({ message: 'Temporary failure' }, true);
    expect(control('Previous results').disabled).toBe(false);
    control('Previous results').click();
    expect(sent.mock.calls.at(-1)?.[0].params.arguments.offset).toBe(0);
    await reply({ offset: 0, json: 'first', nextOffset: 7 });
    expect(control('Previous results').disabled).toBe(true);
    control('Next results').click();
    await reply({ offset: 7, json: 'second', nextOffset: 19 });
    control('Back to products').click();
    await reply(table(0, 10));
    expect(control('Previous results').disabled).toBe(true);
    control('Next results').click();
    await reply(table(10));
    const picker = window.document.querySelector<HTMLSelectElement>('#output-picker')!;
    picker.value = nodeIds[1]; picker.dispatchEvent(new window.Event('change'));
    await reply(table(0, 10));
    expect(control('Previous results').disabled).toBe(true);
    control('Next results').click();
    await reply(table(10));
    open({ ...initial, run: { ...runData, runId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' } });
    await reply(table(0));
    expect(control('Previous results').disabled).toBe(true);
  });

  it('shows configured skills outside the initial catalog and refreshes graph metadata when fetched', async () => {
    const { window, initialize, open, reply } = mount();
    await initialize();
    const names = ['nexscope_later_search', 'nexscope_other_search', ''];
    open({ ...initial, catalog: { ...initial.catalog, nextCursor: 'next' },
      canvas: { id: initial.canvases.items[0].id, name: 'Later skills', revision: 1, edges: [],
        nodes: names.map((toolName, i) => ({ id: `skill-${i}`, type: 'skill', x: i * 200, y: 0, config: { toolName, args: {} } })) } });
    const nodes = () => window.document.querySelectorAll<HTMLElement>('.node');
    expect(nodes()[0].textContent).toContain('Configured skill: nexscope_later_search');
    expect(nodes()[0].textContent).not.toContain('Choose a research skill');
    expect(nodes()[2].textContent).toContain('Choose a research skill');
    nodes()[0].click();
    [...window.document.querySelectorAll<HTMLButtonElement>('#inspector button')]
      .find(button => button.textContent === 'Load parameters')!.click();
    await reply({ item: { toolName: names[0], title: 'Later Search', description: 'Search the configured market',
      inputSchema: { properties: {} } } });
    expect(nodes()[0].querySelector('.node-head')?.textContent).toBe('Later Search');
    expect(nodes()[0].querySelector('.node-body')?.textContent).toBe('Search the configured market');
    window.document.querySelector<HTMLButtonElement>('#more-catalog')!.click();
    await reply({ items: [{ toolName: names[1], title: 'Other Search', summary: 'Find other products' }] });
    expect(nodes()[1].querySelector('.node-head')?.textContent).toBe('Other Search');
    expect(nodes()[1].querySelector('.node-body')?.textContent).toBe('Find other products');
  });

  it('prefers complete product metrics over preview rows and preserves zero and row fallback', async () => {
    const { window, initialize, open, reply } = mount();
    await initialize();
    const nodeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    open({ ...initial, run: { runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'SUCCEEDED',
      steps: [{ id: nodeId, nodeType: 'output', status: 'SUCCEEDED' }],
      canvasSnapshot: { id: initial.canvases.items[0].id, name: 'Metrics', revision: 1, edges: [],
        nodes: [{ id: nodeId, type: 'output', x: 0, y: 0, config: { alias: 'Products' } }] } } });
    await reply({ offset: 0, columns: ['/title'], rows: [
      { '/title': 'Omitted metrics' }, { '/rating': 1, '/ratings': 99, '/monthlySalesUnits': 999 },
      { '/rating': 4.2, '/reviewCount': 12, '/monthlySalesUnits': 34 },
    ], products: [
      { id: 'A', rowIndex: 0, rating: 4.9, reviewCount: 123, monthlySalesUnits: 456 },
      { id: 'B', rowIndex: 1, rating: 0, ratings: 0, reviewCount: 88, monthlySalesUnits: 0 },
      { id: 'C', rowIndex: 2 },
    ] });
    const values = [...window.document.querySelectorAll('.product')].map(card =>
      [...card.querySelectorAll('.product-metrics strong')].map(value => value.textContent));
    expect(values).toEqual([
      ['Unavailable', '4.9 / 5', '123', '456'],
      ['Unavailable', '0.0 / 5', '0', '0'],
      ['Unavailable', '4.2 / 5', '12', '34'],
    ]);
  });

  it('opens a saved conversation draft for editing and sends creation only on click', async () => {
    const { window, sent, initialize, open } = mount();
    await initialize();
    const draft = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Keyword ideas', revision: 3, nodes: [], edges: [] };
    open({ ...initial, canvas: draft });
    expect(window.document.querySelector<HTMLInputElement>('#canvas-name')?.value).toBe('Keyword ideas');
    expect(window.document.querySelector('#notice')?.textContent).toMatch(/Draft saved.*not run.*Revision 3/i);
    expect(sent.mock.calls.filter(([request]) => request.method === 'tools/call')).toHaveLength(0);
    window.document.querySelector<HTMLInputElement>('#draft-prompt')!.value = 'Compare desk lamps';
    window.document.querySelector<HTMLButtonElement>('#create-draft')!.click();
    expect(sent.mock.calls.at(-1)?.[0]).toMatchObject({ method: 'ui/message' });
    expect(sent.mock.calls.filter(([request]) => request.method === 'tools/call')).toHaveLength(0);
  });

  it('loads a saved draft skill schema before asking to run', async () => {
    const { window, sent, initialize, open, reply } = mount();
    await initialize();
    const skillId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', outputId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    open({ ...initial, canvas: { id: initial.canvases.items[0].id, name: 'Saved search', revision: 2,
      nodes: [{ id: skillId, type: 'skill', x: 0, y: 0, config: { toolName: 'nexscope_amazon_search', args: { keyword: 'lamps' } } },
        { id: outputId, type: 'output', x: 250, y: 0, config: { value: null, alias: 'Products' } }],
      edges: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', from: skillId, fromPath: '', to: outputId, toPath: '/value' }] } });
    window.document.querySelector<HTMLButtonElement>('#run-all')!.click();
    expect(sent.mock.calls.at(-1)?.[0].params.arguments).toMatchObject({ action: 'catalog', toolName: 'nexscope_amazon_search' });
    await reply({ item: { toolName: 'nexscope_amazon_search', title: 'Amazon Search',
      inputSchema: { properties: { keyword: { type: 'string' } }, required: ['keyword'] }, requiredAnyGroups: [], creditCost: 1 } });
    expect(window.document.querySelector<HTMLDialogElement>('#confirm-run')?.open).toBe(true);
    expect(sent.mock.calls.filter(([request]) => request.method === 'tools/call' && ['start', 'step'].includes(request.params.arguments.action))).toHaveLength(0);
  });

  it('exports complete selected rows across Unicode blocks with all CSV fields', async () => {
    const { window, sent, initialize, open, reply } = mount();
    await initialize();
    const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', nodeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const canvas = { id: initial.canvases.items[0].id, name: 'Research', revision: 1,
      nodes: [{ id: nodeId, type: 'output', x: 0, y: 0, config: { value: null, alias: 'Products' } }], edges: [] };
    open({ ...initial, run: { runId, status: 'SUCCEEDED', revision: 1,
      steps: [{ id: nodeId, nodeType: 'output', status: 'SUCCEEDED' }], outputs: [{ alias: 'Products' }], canvasSnapshot: canvas } });
    expect(sent.mock.calls.at(-1)?.[0].params.arguments).toMatchObject({ action: 'result', view: 'table', nodeId });
    await reply({ offset: 0, rows: [{ '/id': 'duplicate' }, { '/id': 'duplicate' }], columns: ['/id'],
      products: [{ id: 'duplicate', platform: 'amazon', rowIndex: 0, title: 'A' }, { id: 'duplicate', platform: 'amazon', rowIndex: 1, title: 'B' }] });
    window.document.querySelector<HTMLInputElement>('.product input')!.click();
    window.document.querySelector<HTMLSelectElement>('#export-scope')!.value = 'selected';
    window.document.querySelector<HTMLSelectElement>('#export-scope')!.dispatchEvent(new window.Event('change'));
    window.document.querySelector<HTMLButtonElement>('#export-csv')!.click();
    const first = sent.mock.calls.at(-1)?.[0];
    expect(first.params.arguments).toMatchObject({ action: 'result', view: 'json', offset: 0, rowIndexes: [0] });
    const original = [{ id: 'duplicate', long: '😀'.repeat(17000), later: '=2+2', nested: { note: 'line\n"quoted"' } }];
    const json = JSON.stringify(original), points = [...json], part = points.slice(0, 16000).join('');
    await reply({ json: part, offset: 0, nextOffset: 16000, truncated: true });
    expect(sent.mock.calls.at(-1)?.[0].params.arguments.offset).toBe(16000);
    await reply({ json: points.slice(16000).join(''), offset: 16000, truncated: false });
    const text = window.document.querySelector<HTMLTextAreaElement>('#export-text')!.value;
    expect(text).toContain('"later"');
    expect(text).toContain("'=2+2");
    expect(text.includes('""note""')).toBe(true);
    expect(text.includes('😀'.repeat(17000))).toBe(true);
    expect(window.document.querySelector('#export-copy')?.hasAttribute('hidden')).toBe(false);
    expect(sent.mock.calls.filter(([request]) => request.method === 'tools/call' && ['start', 'step'].includes(request.params.arguments.action))).toHaveLength(0);
  });

  it('rejects an incomplete export block without offering partial text', async () => {
    const { window, sent, initialize, open, reply } = mount();
    await initialize();
    const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', nodeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    open({ ...initial, run: { runId, status: 'SUCCEEDED', revision: 1,
      steps: [{ id: nodeId, nodeType: 'output', status: 'SUCCEEDED' }], outputs: [{ alias: 'Result' }],
      canvasSnapshot: { id: initial.canvases.items[0].id, name: 'Research', revision: 1,
        nodes: [{ id: nodeId, type: 'output', x: 0, y: 0, config: { value: null, alias: 'Result' } }], edges: [] } } });
    await reply({ offset: 0, columns: ['/name'], rows: [{ '/name': 'A' }], products: [] });
    window.document.querySelector<HTMLButtonElement>('#export-json')!.click();
    expect(sent.mock.calls.at(-1)?.[0].params.arguments).toMatchObject({ action: 'result', view: 'json', offset: 0 });
    await reply({ json: '{"name":"A"}', offset: 0, nextOffset: 99, truncated: true });
    expect(window.document.querySelector('#export-status')?.textContent).toMatch(/Incomplete result/i);
    expect(window.document.querySelector<HTMLTextAreaElement>('#export-text')?.value).toBe('');
    expect(window.document.querySelector('#export-copy')?.hasAttribute('hidden')).toBe(true);
  });

  it('loads the completed output over an earlier skill view, then preserves a manual choice', async () => {
    const { window, sent, initialize, open, reply } = mount();
    await initialize();
    const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const skillId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', outputId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const steps = [{ id: skillId, nodeType: 'skill', status: 'SUCCEEDED' },
      { id: outputId, nodeType: 'output', status: 'PENDING' }];
    const snapshot = { id: initial.canvases.items[0].id, name: 'Research', revision: 1,
      nodes: [{ id: skillId, type: 'skill', x: 0, y: 0, config: { toolName: 'nexscope_amazon_search', args: {} } },
        { id: outputId, type: 'output', x: 250, y: 0, config: { value: null, alias: 'Chosen' } }], edges: [] };
    open({ ...initial, run: { runId, status: 'RUNNING', revision: 1, steps, outputs: [], canvasSnapshot: snapshot } });
    window.document.querySelector<HTMLButtonElement>('#run-steps button')!.click();
    await reply({ offset: 0, columns: ['/name'], rows: [{ '/name': 'Skill data' }], products: [] });
    expect(window.document.querySelector('#result')?.textContent).toContain('Skill data');
    window.document.querySelector<HTMLButtonElement>('#refresh')!.click();
    await reply({ runId, status: 'SUCCEEDED', revision: 2,
      steps: [steps[0], { ...steps[1], status: 'SUCCEEDED' }], outputs: [{ alias: 'Chosen' }] });
    expect(sent.mock.calls.at(-1)?.[0].params.arguments).toMatchObject({ action: 'result', nodeId: outputId });
    await reply({ offset: 0, columns: ['/name'], rows: [{ '/name': 'Output data' }], products: [] });
    expect(window.document.querySelector('#result')?.textContent).toContain('Output data');
    window.document.querySelector<HTMLButtonElement>('#run-steps button')!.click();
    await reply({ offset: 0, columns: ['/name'], rows: [{ '/name': 'Manual skill data' }], products: [] });
    window.document.querySelector<HTMLButtonElement>('#refresh')!.click();
    await reply({ runId, status: 'SUCCEEDED', revision: 2,
      steps: [steps[0], { ...steps[1], status: 'SUCCEEDED' }], outputs: [{ alias: 'Chosen' }] });
    expect(sent.mock.calls.at(-1)?.[0].params.arguments.action).toBe('status');
    expect(window.document.querySelector('#result')?.textContent).toContain('Manual skill data');
  });
  it('uses a pinned host origin and opens from the first tool result without another call', async () => {
    const { window, sent, emit, initialize, open } = mount();
    expect(sent.mock.calls[0][0]).toMatchObject({ method: 'ui/initialize', params: { protocolVersion: '2026-01-26' } });
    await initialize();
    emit({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { ok: true, data: initial } } }, null);
    expect(window.document.querySelector('#canvases')?.textContent).toBe('');
    emit({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { ok: true, data: initial } } }, window, 'https://evil.example');
    expect(window.document.querySelector('#canvases')?.textContent).toBe('');
    open(initial);
    expect(window.document.querySelector('#canvases')?.textContent).toContain('Saved research');
    expect(sent.mock.calls.map(([request]) => request.method)).toEqual(['ui/initialize', 'ui/notifications/initialized']);
  });

  it('moves focus into drawers, restores it, and closes them when switching views', async () => {
    const { window, initialize, open } = mount();
    await initialize(); open(initial);
    const library = window.document.querySelector<HTMLButtonElement>('#library-toggle')!;
    library.focus(); library.click();
    expect(window.document.activeElement?.id).toBe('close-library');
    expect(window.document.querySelector<HTMLElement>('.workspace')!.inert).toBe(true);
    window.document.querySelector<HTMLButtonElement>('#close-library')!.click();
    expect(window.document.activeElement).toBe(library);
    const settings = window.document.querySelector<HTMLButtonElement>('#settings-toggle')!;
    settings.focus(); settings.click();
    expect(window.document.activeElement?.id).toBe('close-settings');
    window.document.querySelector<HTMLButtonElement>('#tab-results')!.click();
    expect(window.document.querySelector('.right')?.classList.contains('open')).toBe(false);
    expect(window.document.activeElement?.id).toBe('tab-results');
    expect(window.document.querySelector<HTMLElement>('.workspace')!.inert).toBe(false);
  });

  it('keeps editing free and requires a saved graph plus explicit credit confirmation', async () => {
    const { window, sent, initialize, open, reply } = mount();
    await initialize(); open(initial);
    window.document.querySelector<HTMLButtonElement>('#template')!.click();
    expect(window.document.querySelectorAll('.node')).toHaveLength(2);
    expect(sent).toHaveBeenCalledTimes(2);
    window.document.querySelector<HTMLButtonElement>('#run-all')!.click();
    expect(window.document.querySelector('#notice')?.textContent).toMatch(/Save the current canvas/i);
    window.document.querySelector<HTMLButtonElement>('#save')!.click();
    const request = sent.mock.calls.at(-1)?.[0];
    expect(request.method).toBe('tools/call');
    expect(request.params).toMatchObject({ name: 'nexscope_workflow', arguments: { action: 'save' } });
    const graph = request.params.arguments.canvas;
    await reply({ canvas: { ...graph, revision: 1 } });
    expect(window.document.querySelector('#notice')?.textContent).toMatch(/Canvas saved/i);
    expect(sent.mock.calls.filter(([r]) => r.method === 'tools/call' && r.params.arguments.action === 'step')).toHaveLength(0);
  });

  it('keeps a dirty draft when discard is canceled and clears it only after visible confirmation', async () => {
    const { window, sent, initialize, open } = mount();
    await initialize(); open(initial);
    window.document.querySelectorAll<HTMLButtonElement>('#palette button')[0].click();
    window.document.querySelectorAll<HTMLButtonElement>('#palette button')[2].click();
    const originalIds = [...window.document.querySelectorAll<HTMLElement>('.node')].map(node => node.dataset.nodeId);
    window.document.querySelector<HTMLButtonElement>('#blank')!.click();
    expect(window.document.querySelector<HTMLDialogElement>('#confirm-edit')!.open).toBe(true);
    expect(window.document.querySelector('#confirm-message')?.textContent).toContain('Discard unsaved');
    window.document.querySelector<HTMLButtonElement>('#confirm-cancel')!.click();
    await Promise.resolve();
    expect([...window.document.querySelectorAll<HTMLElement>('.node')].map(node => node.dataset.nodeId)).toEqual(originalIds);
    window.document.querySelector<HTMLButtonElement>('#blank')!.click();
    window.document.querySelector<HTMLDialogElement>('#confirm-edit')!.dispatchEvent(new window.Event('cancel', { cancelable: true }));
    await Promise.resolve();
    expect([...window.document.querySelectorAll<HTMLElement>('.node')].map(node => node.dataset.nodeId)).toEqual(originalIds);
    window.document.querySelector<HTMLButtonElement>('#blank')!.click();
    window.document.querySelector<HTMLButtonElement>('#confirm-accept')!.click();
    await Promise.resolve();
    expect(window.document.querySelectorAll('.node')).toHaveLength(0);
    expect(window.document.querySelector('#notice')?.textContent).toContain('Blank draft created');
    expect(sent.mock.calls.filter(([request]) => request.method === 'tools/call')).toHaveLength(0);
  });

  it('applies JSON and bounded positions from explicit Inspector controls', async () => {
    const { window, sent, initialize, open } = mount();
    await initialize(); open(initial);
    window.document.querySelectorAll<HTMLButtonElement>('#palette button')[0].click();
    const control = (label: string) => {
      const lab = [...window.document.querySelectorAll<HTMLLabelElement>('#inspector label')].find(item => item.textContent === label)!;
      return { input: window.document.getElementById(lab.htmlFor) as HTMLInputElement | HTMLTextAreaElement,
        apply: lab.parentElement!.querySelector<HTMLButtonElement>(`[aria-label="Apply ${label}"]`)! };
    };
    const json = control('Input JSON');
    json.input.value = '{"value":42}';
    expect(window.document.querySelector('.node-body')?.textContent).toContain('Set the starting information');
    json.apply.click();
    expect(control('Input JSON').input.value).toContain('42');
    const invalid = control('Input JSON');
    invalid.input.value = '{bad';
    invalid.apply.click();
    expect(window.document.querySelector('#notice')?.textContent).toContain('Invalid JSON');
    const x = control('Position X');
    x.input.value = '10001';
    x.apply.click();
    expect(window.document.querySelector('#notice')?.textContent).toContain('Position must');
    control('Position X').input.value = '120';
    control('Position X').apply.click();
    const y = control('Position Y');
    y.input.value = '-10001';
    y.apply.click();
    expect(window.document.querySelector('#notice')?.textContent).toContain('Position must');
    control('Position Y').input.value = '75';
    control('Position Y').apply.click();
    window.document.querySelector<HTMLButtonElement>('#save')!.click();
    expect(sent.mock.calls.at(-1)?.[0].params.arguments.canvas.nodes[0]).toMatchObject({
      x: 120, y: 75, config: { value: { value: 42 } },
    });
  });

  it('never calls actions without serverTools and keeps script-like text inert', async () => {
    const { window, sent, initialize, open } = mount({});
    await initialize();
    open({ ...initial, canvases: { items: [{ ...initial.canvases.items[0], name: '<img src=x onerror=alert(1)>' }] } });
    expect(window.document.querySelector('#canvases')?.textContent).toContain('<img src=x');
    expect(window.document.querySelector('#canvases img')).toBeNull();
    expect(window.document.querySelector<HTMLButtonElement>('#template')?.disabled).toBe(true);
    expect(sent.mock.calls.map(([request]) => request.method)).toEqual(['ui/initialize', 'ui/notifications/initialized']);
  });

  it('loads run history as a read-only snapshot and never replays a waiting paid node', async () => {
    const { window, sent, initialize, open, reply } = mount();
    await initialize(); open(initial);
    window.document.querySelector<HTMLButtonElement>('#history')!.click();
    expect(sent.mock.calls.at(-1)?.[0].params.arguments).toEqual({ action: 'list', kind: 'run' });
    await reply({ items: [{ runId: '22222222-2222-4222-8222-222222222222', canvasId: initial.canvases.items[0].id, status: 'WAITING', createdAt: '2026-10-01T00:00:00Z', progress: {} }] });
    window.document.querySelector<HTMLButtonElement>('#runs button')!.click();
    expect(sent.mock.calls.at(-1)?.[0].params.arguments).toMatchObject({ action: 'status', includeSnapshot: true });
    await reply({ runId: '22222222-2222-4222-8222-222222222222', status: 'WAITING', revision: 3, steps: [{ id: '33333333-3333-4333-8333-333333333333', nodeType: 'skill', status: 'WAITING_PROVIDER' }], outputs: [], canvasSnapshot: { id: initial.canvases.items[0].id, name: 'Historical', revision: 1, nodes: [{ id: '33333333-3333-4333-8333-333333333333', type: 'skill', x: 20, y: 20, config: { toolName: 'nexscope_amazon_search', args: {} } }], edges: [] } });
    expect(window.document.querySelector('#canvas-name')?.getAttribute('value')).not.toContain('Historical');
    expect((window.document.querySelector('#canvas-name') as HTMLInputElement).value).toBe('Historical');
    expect(window.document.querySelector('#run-steps')?.textContent).toContain('Waiting for provider');
    expect(window.document.querySelector('.node-status')?.textContent).not.toContain('{');
    expect(window.document.querySelector<HTMLButtonElement>('#run-all')?.disabled).toBe(true);
    expect(sent.mock.calls.filter(([r]) => r.method === 'tools/call' && r.params.arguments.action === 'step')).toHaveLength(0);
  });

  it('starts only after confirmation and does not replay an uncertain step', async () => {
    const { window, sent, initialize, open, reply } = mount();
    await initialize(); open(initial);
    window.document.querySelector<HTMLButtonElement>('#blank')!.click();
    window.document.querySelector<HTMLButtonElement>('#palette button')!.click();
    window.document.querySelector<HTMLButtonElement>('#save')!.click();
    const graph = sent.mock.calls.at(-1)?.[0].params.arguments.canvas;
    await reply({ canvas: { ...graph, revision: 1 } });
    window.document.querySelector<HTMLButtonElement>('#run-node')!.click();
    expect(window.document.querySelector<HTMLDialogElement>('#confirm-run')!.open).toBe(true);
    expect(sent.mock.calls.filter(([r]) => r.method === 'tools/call' && r.params.arguments.action === 'start')).toHaveLength(0);
    window.document.querySelector<HTMLButtonElement>('#confirm-start')!.click();
    const start = sent.mock.calls.at(-1)?.[0];
    expect(start.params.arguments).toMatchObject({ action: 'start', mode: 'node', nodeId: graph.nodes[0].id });
    const runId = start.params.arguments.requestId;
    await reply({ runId, status: 'READY', revision: 0, steps: [{ id: graph.nodes[0].id, nodeType: 'input', status: 'PENDING' }] });
    expect(sent.mock.calls.at(-1)?.[0].params.arguments.action).toBe('status');
    await reply({ runId, status: 'READY', revision: 0, steps: [{ id: graph.nodes[0].id, nodeType: 'input', status: 'PENDING' }], outputs: [] });
    expect(sent.mock.calls.at(-1)?.[0].params.arguments).toMatchObject({ action: 'step', nodeId: graph.nodes[0].id });
    await reply({ runId, status: 'RUNNING', revision: 1, node: { id: graph.nodes[0].id, nodeType: 'input', status: 'RUNNING' } });
    expect(sent.mock.calls.at(-1)?.[0].params.arguments.action).toBe('status');
    await reply({ runId, status: 'RUNNING', revision: 1, steps: [{ id: graph.nodes[0].id, nodeType: 'input', status: 'RUNNING' }], outputs: [] });
    expect(sent.mock.calls.filter(([r]) => r.method === 'tools/call' && r.params.arguments.action === 'step')).toHaveLength(1);
  });

  it('paginates results and sends only selected real product data to context', async () => {
    const caps = { serverTools: {}, updateModelContext: { text: {} }, experimental: { 'openai/modelContext': {} } };
    const { window, sent, emit, initialize, open, reply } = mount(caps);
    await initialize(); open(initial);
    window.document.querySelector<HTMLButtonElement>('#history')!.click();
    await reply({ items: [{ runId: '22222222-2222-4222-8222-222222222222', status: 'SUCCEEDED' }] });
    window.document.querySelector<HTMLButtonElement>('#runs button')!.click();
    const nodeId = '33333333-3333-4333-8333-333333333333';
    await reply({ runId: '22222222-2222-4222-8222-222222222222', status: 'SUCCEEDED', revision: 1,
      steps: [{ id: nodeId, nodeType: 'skill', status: 'SUCCEEDED' }], outputs: [],
      canvasSnapshot: { id: initial.canvases.items[0].id, name: 'Historical', revision: 1, nodes: [{ id: nodeId, type: 'skill', x: 0, y: 0, config: { toolName: 'nexscope_amazon_search', args: {} } }], edges: [] },
    });
    window.document.querySelector<HTMLButtonElement>('#run-steps button')!.click();
    expect(sent.mock.calls.at(-1)?.[0].params.arguments).toMatchObject({ action: 'result', view: 'table', offset: 0 });
    await reply({ columns: ['/title', '/asin', '/rating', '/ratings'], rows: [{ '/title': 'Other', '/asin': 'B456', '/rating': true, '/ratings': [] }, { '/title': 'Lamp', '/asin': 'B123', '/rating': 4.8, '/ratings': 320 }], products: [
      { id: 'B123', rowIndex: 1, title: '<script>lamp</script>', imageUrl: 'https://m.media-amazon.com/a.jpg', url: 'https://www.amazon.com/dp/B123', platform: 'amazon', price: 19.99, currency: 'EUR' },
      { id: 'B456', rowIndex: 0, title: 'Unsafe image', imageUrl: 'https://m.media-amazon.com.evil.example/a.jpg', platform: 'amazon', price: 22.5 },
      { id: 'B789', rowIndex: 2, title: 'Missing values', platform: 'amazon', price: '' },
    ], offset: 0, nextOffset: 10, truncated: true });
    expect(window.document.querySelectorAll('.product img')).toHaveLength(1);
    expect(window.document.querySelector('.product a')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(window.document.querySelector('.product')?.textContent).toContain('<script>lamp</script>');
    expect(window.document.querySelector('.product')?.textContent).toContain('4.8 / 5');
    expect(window.document.querySelector('.product')?.textContent).toContain('320');
    expect(window.document.querySelector('.product')?.textContent).toContain('€19.99');
    expect(window.document.querySelectorAll('.product')[1].textContent).toContain('22.50');
    expect(window.document.querySelectorAll('.product')[1].textContent).not.toContain('$22.50');
    expect(window.document.querySelectorAll('.product')[1].textContent).toContain('Unavailable');
    expect(window.document.querySelectorAll('.product')[2].textContent).toContain('Unavailable');
    window.document.querySelector<HTMLImageElement>('.product img')!.dispatchEvent(new window.Event('error'));
    expect(window.document.querySelector('.product .image-placeholder')?.textContent).toContain('Image unavailable');
    expect(window.document.querySelector('#result table')).toBeNull();
    window.document.querySelector<HTMLInputElement>('.product input')!.click();
    window.document.querySelector<HTMLButtonElement>('#add-context')!.click();
    const context = sent.mock.calls.at(-1)?.[0];
    expect(context.method).toBe('ui/update-model-context');
    expect(context.params.content[0]._meta).toMatchObject({ 'nexscope/productId': 'B123', 'nexscope/platform': 'amazon' });
    expect(JSON.stringify(context.params.content)).not.toContain('B456');
    expect(JSON.stringify(context.params.content).length).toBeLessThanOrEqual(6000);
    emit({ jsonrpc: '2.0', id: context.id, result: { _meta: { 'openai/modelContext': { updateId: 'confirmed' } } } });
    await Promise.resolve();
    expect(window.document.querySelector('#notice')?.textContent).toMatch(/added to the conversation/i);
  });

  it('never schedules a historical B step after an A step replies late', async () => {
    const { window, sent, emit, initialize, open, reply } = mount();
    await initialize(); open(initial);
    const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const first = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222';
    const snapshot = { id: initial.canvases.items[0].id, name: 'Shared graph', revision: 1,
      nodes: [first, second].map((id, i) => ({ id, type: 'input', x: i * 120, y: 0, config: { value: i } })), edges: [] };
    const steps = [first, second].map(id => ({ id, nodeType: 'input', status: 'PENDING' }));
    window.document.querySelector<HTMLButtonElement>('#history')!.click();
    await reply({ items: [{ runId: a, status: 'READY' }, { runId: b, status: 'READY' }] });
    window.document.querySelectorAll<HTMLButtonElement>('#runs button')[0].click();
    await reply({ runId: a, status: 'READY', revision: 0, steps, outputs: [], canvasSnapshot: snapshot });
    window.document.querySelector<HTMLButtonElement>('#continue')!.click();
    await reply({ runId: a, status: 'READY', revision: 0, steps, outputs: [] });
    const oldStep = sent.mock.calls.at(-1)?.[0];
    expect(oldStep.params.arguments).toMatchObject({ action: 'step', runId: a, nodeId: first });
    window.document.querySelectorAll<HTMLButtonElement>('#runs button')[1].click();
    await reply({ runId: b, status: 'READY', revision: 0, steps, outputs: [], canvasSnapshot: snapshot });
    emit({ jsonrpc: '2.0', id: oldStep.id, result: { structuredContent: { ok: true, data: {
      runId: a, status: 'READY', node: { id: first, nodeType: 'input', status: 'SUCCEEDED' }, revision: 1,
    } } } });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(window.document.querySelector('#run-state')?.getAttribute('title')).toBe(b);
    expect(sent.mock.calls.filter(([r]) => r.method === 'tools/call' && r.params.arguments.action === 'step')).toHaveLength(1);
  });

  it('ignores late status and result responses after switching runs', async () => {
    const { window, sent, emit, initialize, open, reply } = mount();
    await initialize(); open(initial);
    const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const nodeId = '33333333-3333-4333-8333-333333333333';
    const snapshot = { id: initial.canvases.items[0].id, name: 'Snapshot', revision: 1,
      nodes: [{ id: nodeId, type: 'input', x: 0, y: 0, config: { value: 'hello' } }], edges: [] };
    const steps = [{ id: nodeId, nodeType: 'input', status: 'SUCCEEDED' }];
    window.document.querySelector<HTMLButtonElement>('#history')!.click();
    await reply({ items: [{ runId: a, status: 'SUCCEEDED' }, { runId: b, status: 'SUCCEEDED' }] });
    window.document.querySelectorAll<HTMLButtonElement>('#runs button')[0].click();
    await reply({ runId: a, status: 'SUCCEEDED', revision: 1, steps, outputs: [], canvasSnapshot: snapshot });
    window.document.querySelector<HTMLButtonElement>('#refresh')!.click();
    const oldStatus = sent.mock.calls.at(-1)?.[0];
    window.document.querySelectorAll<HTMLButtonElement>('#runs button')[1].click();
    await reply({ runId: b, status: 'SUCCEEDED', revision: 1, steps, outputs: [], canvasSnapshot: snapshot });
    emit({ jsonrpc: '2.0', id: oldStatus.id, result: { structuredContent: { ok: true, data: {
      runId: a, status: 'FAILED', revision: 2, steps: [], outputs: [],
    } } } });
    await Promise.resolve();
    expect(window.document.querySelector('#run-state')?.getAttribute('title')).toBe(b);
    window.document.querySelector<HTMLButtonElement>('#run-steps button')!.click();
    const oldResult = sent.mock.calls.at(-1)?.[0];
    window.document.querySelectorAll<HTMLButtonElement>('#runs button')[0].click();
    await reply({ runId: a, status: 'SUCCEEDED', revision: 1, steps, outputs: [], canvasSnapshot: snapshot });
    emit({ jsonrpc: '2.0', id: oldResult.id, result: { structuredContent: { ok: true, data: {
      json: 'STALE B RESULT', offset: 0, truncated: false,
    } } } });
    await Promise.resolve();
    expect(window.document.querySelector('#run-state')?.getAttribute('title')).toBe(a);
    expect(window.document.querySelector('#result')?.textContent).not.toContain('STALE B RESULT');
  });

  it('ignores a stale skill detail after navigating to a new canvas', async () => {
    const { window, sent, emit, initialize, open } = mount();
    await initialize(); open(initial);
    window.document.querySelector<HTMLButtonElement>('#template')!.click();
    [...window.document.querySelectorAll<HTMLButtonElement>('#inspector button')].find(button => button.textContent === 'Load parameters')!.click();
    const detail = sent.mock.calls.at(-1)?.[0];
    expect(detail.params.arguments).toMatchObject({ action: 'catalog', toolName: 'nexscope_amazon_search' });
    window.document.querySelector<HTMLButtonElement>('#blank')!.click();
    expect(window.document.querySelector<HTMLDialogElement>('#confirm-edit')!.open).toBe(true);
    window.document.querySelector<HTMLButtonElement>('#confirm-accept')!.click();
    await Promise.resolve();
    emit({ jsonrpc: '2.0', id: detail.id, result: { structuredContent: { ok: true, data: { item: {
      toolName: 'nexscope_amazon_search', inputSchema: { properties: { secretField: { type: 'string' } } },
    } } } } });
    await Promise.resolve();
    expect(window.document.querySelectorAll('.node')).toHaveLength(0);
    expect(window.document.querySelector('#inspector')?.textContent).not.toContain('secretField');
  });

  it('allows a real reply on a read-only historical analysis run', async () => {
    const { window, sent, initialize, open, reply } = mount();
    await initialize(); open(initial);
    const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', nodeId = '33333333-3333-4333-8333-333333333333';
    window.document.querySelector<HTMLButtonElement>('#history')!.click();
    await reply({ items: [{ runId, status: 'WAITING' }] });
    window.document.querySelector<HTMLButtonElement>('#runs button')!.click();
    await reply({ runId, status: 'WAITING', revision: 1,
      steps: [{ id: nodeId, nodeType: 'analysis', status: 'WAITING_USER' }], outputs: [],
      canvasSnapshot: { id: initial.canvases.items[0].id, name: 'Assessment', revision: 1,
        nodes: [{ id: nodeId, type: 'analysis', x: 0, y: 0, config: { source: null, prompt: 'Review it' } }], edges: [] },
    });
    window.document.querySelector<HTMLElement>('.node')!.click();
    const replyLabel = [...window.document.querySelectorAll<HTMLLabelElement>('#inspector label')].find(label => label.textContent === 'Actual analysis reply')!;
    const replyField = window.document.getElementById(replyLabel.htmlFor) as HTMLTextAreaElement;
    expect(window.document.querySelector<HTMLInputElement>('#canvas-name')?.disabled).toBe(true);
    expect(replyField.disabled).toBe(false);
    replyField.value = 'Actual model assessment';
    replyField.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(sent.mock.calls.at(-1)?.[0].params.arguments.action).toBe('status');
    [...window.document.querySelectorAll<HTMLButtonElement>('#inspector button')].find(button => button.getAttribute('aria-label') === 'Apply Actual analysis reply')!.click();
    expect(sent.mock.calls.at(-1)?.[0].params.arguments).toMatchObject({ action: 'supply_output', runId, nodeId, text: 'Actual model assessment' });
    await reply({ runId, node: { id: nodeId, nodeType: 'analysis', status: 'SUCCEEDED' }, revision: 2 });
    expect(sent.mock.calls.at(-1)?.[0].params.arguments).toMatchObject({ action: 'status', runId });
    await reply({ runId, status: 'SUCCEEDED', revision: 2,
      steps: [{ id: nodeId, nodeType: 'analysis', status: 'SUCCEEDED' }], outputs: [] });
    expect(window.document.querySelector('#run-state')?.textContent).toContain('Complete');
  });

  it.each(['"scalar value"', '{"realField":42}'])('opens first non-table result as JSON: %s', async json => {
    const { window, sent, initialize, open, reply } = mount();
    await initialize(); open(initial);
    const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', nodeId = '33333333-3333-4333-8333-333333333333';
    window.document.querySelector<HTMLButtonElement>('#history')!.click();
    await reply({ items: [{ runId, status: 'SUCCEEDED' }] });
    window.document.querySelector<HTMLButtonElement>('#runs button')!.click();
    await reply({ runId, status: 'SUCCEEDED', revision: 1,
      steps: [{ id: nodeId, nodeType: 'input', status: 'SUCCEEDED' }], outputs: [],
      canvasSnapshot: { id: initial.canvases.items[0].id, name: 'Result', revision: 1,
        nodes: [{ id: nodeId, type: 'input', x: 0, y: 0, config: { value: null } }], edges: [] },
    });
    window.document.querySelector<HTMLButtonElement>('#run-steps button')!.click();
    expect(sent.mock.calls.at(-1)?.[0].params.arguments).toMatchObject({ action: 'result', view: 'table' });
    await reply({ code: 'RESULT_NOT_TABULAR', message: 'Use JSON view.' }, true);
    expect(sent.mock.calls.at(-1)?.[0].params.arguments).toMatchObject({ action: 'result', view: 'json', offset: 0 });
    await reply({ json, offset: 0, truncated: false });
    expect(window.document.querySelector('#result pre')?.textContent).toBe(json);
  });

  it('uses new IDs for two confirmed runs and a changed run scope', async () => {
    const { window, sent, initialize, open, reply } = mount();
    await initialize(); open(initial);
    window.document.querySelector<HTMLButtonElement>('#blank')!.click();
    window.document.querySelectorAll<HTMLButtonElement>('#palette button')[0].click();
    window.document.querySelectorAll<HTMLButtonElement>('#palette button')[7].click();
    window.document.querySelector<HTMLButtonElement>('#save')!.click();
    const graph = sent.mock.calls.at(-1)?.[0].params.arguments.canvas;
    await reply({ canvas: { ...graph, revision: 1 } });
    const starts: Array<{ requestId: string; mode: string }> = [];
    for (const mode of ['node', 'node', 'all']) {
      window.document.querySelector<HTMLButtonElement>(mode === 'all' ? '#run-all' : '#run-node')!.click();
      window.document.querySelector<HTMLButtonElement>('#confirm-start')!.click();
      const args = sent.mock.calls.at(-1)?.[0].params.arguments;
      starts.push({ requestId: args.requestId, mode: args.mode });
      await reply({ runId: args.requestId, status: 'SUCCEEDED', revision: 0, steps: [] });
      await reply({ runId: args.requestId, status: 'SUCCEEDED', revision: 0, steps: [], outputs: [] });
      await reply({ runId: args.requestId, status: 'SUCCEEDED', revision: 0, steps: [], outputs: [] });
      await vi.waitFor(() => expect(window.document.querySelector<HTMLButtonElement>('#run-node')?.disabled).toBe(false));
    }
    expect(starts.map(s => s.mode)).toEqual(['node', 'node', 'all']);
    expect(new Set(starts.map(s => s.requestId)).size).toBe(3);
    expect(window.document.querySelector('#notice')?.textContent).toContain('Research complete');
  });

  it('retries an uncertain start with its original request fingerprint', async () => {
    const { window, sent, initialize, open, reply } = mount({ serverTools: {} }, true);
    await initialize(); open(initial);
    window.document.querySelector<HTMLButtonElement>('#blank')!.click();
    window.document.querySelectorAll<HTMLButtonElement>('#palette button')[0].click();
    window.document.querySelector<HTMLButtonElement>('#save')!.click();
    const graph = sent.mock.calls.at(-1)?.[0].params.arguments.canvas;
    await reply({ canvas: { ...graph, revision: 1 } });
    window.document.querySelector<HTMLButtonElement>('#run-node')!.click();
    window.document.querySelector<HTMLButtonElement>('#confirm-start')!.click();
    const first = sent.mock.calls.at(-1)?.[0].params.arguments;
    await new Promise(resolve => setTimeout(resolve, 35));
    expect(window.document.querySelector<HTMLButtonElement>('#retry-start')?.hidden).toBe(false);
    const input = window.document.querySelector<HTMLTextAreaElement>('#inspector textarea')!;
    input.value = '42';
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    window.document.querySelector<HTMLButtonElement>('#save')!.click();
    await reply({ canvas: { ...graph, revision: 2, nodes: [{ ...graph.nodes[0], config: { value: 42 } }] } });
    const newerInput = window.document.querySelector<HTMLTextAreaElement>('#inspector textarea')!;
    newerInput.value = '43';
    newerInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    window.document.querySelector<HTMLButtonElement>('#retry-start')!.click();
    expect(window.document.querySelector<HTMLDialogElement>('#confirm-edit')!.open).toBe(true);
    window.document.querySelector<HTMLButtonElement>('#confirm-accept')!.click();
    await Promise.resolve();
    const retry = sent.mock.calls.at(-1)?.[0].params.arguments;
    expect(retry).toEqual(first);
    expect(retry).toMatchObject({ canvasId: graph.id, revision: 1, mode: 'node', nodeId: graph.nodes[0].id });
  });
});

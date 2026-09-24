import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { antigravityArgs, createAntigravityParser, AntigravityCliAdapter } from '../packages/providers/antigravity';
import { adapterFor, defaultExecutable } from '../packages/providers';
import { providerSchema, type ProviderConfig } from '../packages/contracts';
import { Store } from '../packages/core/storage';
import { ensureDefaultProviders } from '../packages/core/defaults';

const config: ProviderConfig = { id: '00000000-0000-4000-8000-000000000002', name: 'Antigravity test', kind: 'antigravity-cli', model: 'gemini-3-pro', baseUrl: '', executable: '', timeoutMs: 10000 };
const line = (value: object) => JSON.stringify(value) + '\n';
async function temporary(t: any) {
  const parent = path.resolve('.cache/tests'); await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(path.join(parent, 'antigravity-'));
  t.after(async () => { assert.ok(dir.startsWith(parent + path.sep)); await rm(dir, { recursive: true, force: true }); });
  return dir;
}
test('Antigravity parser accepts delta and message frames plus the result envelope', () => {
  for (const [wire, expected] of [
    [line({ type: 'stream_event', event: { delta: { type: 'text_delta', text: '你好' } } }) + line({ type: 'stream_event', event: { delta: { type: 'text_delta', text: '世界' } } }) + line({ type: 'result', status: 'SUCCESS', response: '你好世界' }), '你好世界'],
    [line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }), 'hi'],
    [line({ type: 'message', role: 'assistant', content: 'hi' }), 'hi'],
    [line({ type: 'content_block_delta', delta: { text: 'hi' } }), 'hi'],
    [line({ status: 'SUCCESS', response: 'final only' }), 'final only'],
    [line({ type: 'stream_event', event: { delta: { type: 'thinking_delta', text: 'ignored' } } }) + line({ type: 'result', status: 'SUCCESS', response: 'answer' }), 'answer'],
    [line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '前缀' }] } }) + line({ type: 'result', status: 'SUCCESS', response: '前缀后缀' }), '前缀后缀'],
  ] as const) {
    let output = ''; const parser = createAntigravityParser(e => { if (e.type === 'text') output += e.text; });
    for (let i = 0; i < wire.length; i += 5) parser.push(wire.slice(i, i + 5));
    parser.end(); assert.equal(output, expected);
  }
});
test('Antigravity parser rejects error frames and abnormal statuses', () => {
  for (const [wire, error] of [
    [line({ type: 'error', message: 'not authenticated' }), /not authenticated/],
    [line({ type: 'result', status: 'ERROR', error: { message: 'quota exhausted' } }), /quota exhausted/],
    [line({ status: 'FAILED', response: '' }), /FAILED/],
  ] as const) {
    const parser = createAntigravityParser(() => {});
    assert.throws(() => { parser.push(wire); parser.end(); }, error);
  }
  // Deltas without a result frame are still a valid print-mode run.
  const partial = createAntigravityParser(() => {});
  assert.doesNotThrow(() => { partial.push(line({ type: 'text_delta', text: 'partial' })); partial.end(); });
  // Nothing parseable at all is reported instead of passing silently.
  assert.throws(() => createAntigravityParser(() => {}).end(), /提前中断/);
});
test('Antigravity arguments request print mode, stream-json, plan and sandbox', () => {
  const args = antigravityArgs(); const tuned = antigravityArgs('gemini-3-flash');
  assert.equal(args[0], '-p');
  assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
  assert.equal(args[args.indexOf('--mode') + 1], 'plan');
  assert.ok(args.includes('--sandbox'));
  assert.ok(!args.includes('--model'));
  assert.equal(tuned[tuned.indexOf('--model') + 1], 'gemini-3-flash');
  assert.ok(!args.includes('--dangerously-skip-permissions'));
  assert.equal(defaultExecutable('antigravity-cli'), 'agy');
});
test('Antigravity adapter runs through stdin', async t => {
  const cwd = await temporary(t); const executable = path.join(cwd, 'agy fixture.mjs');
  await writeFile(executable, `import assert from 'node:assert/strict';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('agy fixture 1.2.4'); process.exit(0); }
assert.ok(args.includes('-p'));
assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
assert.equal(args[args.indexOf('--mode') + 1], 'plan');
assert.ok(args.includes('--sandbox'));
assert.equal(args[args.indexOf('--model') + 1], 'gemini-3-pro');
process.stdin.setEncoding('utf8'); let input = ''; for await (const chunk of process.stdin) input += chunk;
console.log(JSON.stringify({ type: 'stream_event', event: { delta: { type: 'text_delta', text: input } } }));
console.log(JSON.stringify({ type: 'result', status: 'SUCCESS', response: input }));
`);
  const prompt = '中文 & echo NO; $(whoami) `literal`'; let output = '';
  assert.equal(providerSchema.parse(config).kind, 'antigravity-cli');
  assert.ok(adapterFor('antigravity-cli') instanceof AntigravityCliAdapter);
  await adapterFor('antigravity-cli').run({ config: { ...config, executable }, cwd, prompt, signal: AbortSignal.timeout(5000) }, e => { if (e.type === 'text') output += e.text; });
  assert.equal(output, prompt);
  // Only Command Code enumerates a model catalog; Antigravity keeps the version probe.
  assert.equal(adapterFor('antigravity-cli').listModels, undefined);
  assert.match(await adapterFor('antigravity-cli').probe({ ...config, executable }), /agy fixture 1\.2\.4/);
});
test('Antigravity default migration adds agy once without replacing a user connection', async t => {
  const dir = await temporary(t); const store = new Store(dir);
  store.state.providers.push({ ...config, executable: 'custom-agy.mjs' }); ensureDefaultProviders(store);
  assert.equal(store.state.providers.filter(p => p.kind === 'antigravity-cli').length, 1);
  assert.equal(store.state.providers[0].executable, 'custom-agy.mjs');
  const id = store.state.providers[0].id;
  const reopened = new Store(dir); ensureDefaultProviders(reopened);
  assert.equal(reopened.state.providers.filter(p => p.kind === 'antigravity-cli').length, 1);
  assert.equal(reopened.state.providers.find(p => p.kind === 'antigravity-cli')!.id, id);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createCommandParser, commandArgs, CommandCliAdapter } from '../packages/providers/command';
import { adapterFor } from '../packages/providers';
import { providerSchema, type ProviderConfig } from '../packages/contracts';
import { Store } from '../packages/core/storage';
import { ensureDefaultProviders } from '../packages/core/defaults';

const config: ProviderConfig = { id: '00000000-0000-4000-8000-000000000001', name: 'Command test', kind: 'command-cli', model: 'test-model', baseUrl: '', executable: '', timeoutMs: 10000 };
const event = (value: object) => JSON.stringify({ type: 'event', event: value }) + '\r\n';
const result = (finalText: string) => JSON.stringify({ type: 'result', subtype: 'success', stopReason: 'end_turn', finalText });
async function temporary(t: any) {
  const parent = path.resolve('.cache/tests'); await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(path.join(parent, 'command-'));
  t.after(async () => { assert.ok(dir.startsWith(parent + path.sep)); await rm(dir, { recursive: true, force: true }); });
  return dir;
}
test('Command CLI decodes split AgentEvent frames without replaying final text', () => {
  let output = ''; const status: string[] = [];
  const parser = createCommandParser(e => { if (e.type === 'text') output += e.text; else if (e.type === 'status') status.push(e.text); });
  const wire = event({ type: 'turn_start', turnNumber: 1 }) + event({ type: 'text_delta', delta: '你好' }) + event({ type: 'text_delta', delta: '世界' }) + event({ type: 'tool_running', toolName: 'read_file' }) + event({ type: 'run_end', result: { finalText: '你好世界' } }) + result('你好世界');
  for (let i = 0; i < wire.length; i += 7) parser.push(wire.slice(i, i + 7));
  parser.end(); assert.equal(output, '你好世界'); assert.match(status.join(''), /read_file/);
});
test('Command CLI handles multiple turns and final-only responses', () => {
  for (const [wire, expected] of [
    [result('final only'), 'final only'],
    [event({ type: 'text_delta', delta: '前缀' }) + result('前缀后缀'), '前缀后缀'],
    [event({ type: 'turn_start' }) + event({ type: 'text_delta', delta: '检查文件' }) + event({ type: 'turn_start' }) + event({ type: 'text_delta', delta: '修改建议' }) + result('修改建议'), '检查文件\n\n修改建议'],
  ]) {
    let output = ''; const p = createCommandParser(e => { if (e.type === 'text') output += e.text; }); p.push(wire); p.end(); assert.equal(output, expected);
  }
});
test('Command CLI fails on errors, interrupted streams and turn limits', () => {
  for (const [wire, error] of [
    [JSON.stringify({ type: 'result', subtype: 'error', error: 'not authenticated' }), /not authenticated/],
    [JSON.stringify({ type: 'result', subtype: 'max_turns', finalText: 'partial' }), /最大轮数/],
    [event({ type: 'run_error', error: { message: 'network failed' } }), /network failed/],
    [event({ type: 'text_delta', delta: 'partial' }), /提前中断/],
    [JSON.stringify({ type: 'result', subtype: 'success', stopReason: 'interrupted', finalText: '' }), /未正常完成/],
  ] as const) {
    const p = createCommandParser(() => {}); assert.throws(() => { p.push(wire); p.end(); }, error);
  }
});
test('Command CLI executes through the registered adapter using stdin and plan mode', async t => {
  const cwd = await temporary(t); const executable = path.join(cwd, 'cmdc fixture.mjs');
  await writeFile(executable, `import assert from 'node:assert/strict';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('fixture 1.0'); process.exit(0); }
assert.ok(args.includes('-p')); assert.equal(args[args.indexOf('--output-format') + 1], 'json');
assert.equal(args[args.indexOf('--permission-mode') + 1], 'plan');
assert.equal(args[args.indexOf('--model') + 1], 'test-model');
assert.ok(args.includes('--no-session')); assert.ok(!args.includes('--yolo'));
process.stdin.setEncoding('utf8'); let input = ''; for await (const chunk of process.stdin) input += chunk;
console.log(JSON.stringify({ type: 'event', event: { type: 'text_delta', delta: input } }));
console.log(JSON.stringify({ type: 'result', subtype: 'success', finalText: input }));
`);
  const prompt = '中文 & echo NO; $(whoami) `literal`'; let output = '';
  assert.equal(providerSchema.parse(config).kind, 'command-cli');
  assert.ok(adapterFor('command-cli') instanceof CommandCliAdapter);
  await adapterFor('command-cli').run({ config: { ...config, executable }, cwd, prompt, signal: AbortSignal.timeout(5000) }, e => { if (e.type === 'text') output += e.text; });
  assert.equal(output, prompt);
  assert.match(await adapterFor('command-cli').probe({ ...config, executable }), /fixture 1.0/);
  assert.ok(!commandArgs().includes('--model'));
});
test('Command CLI maps session grants to CLI flags', () => {
  const plan = commandArgs('m');
  assert.equal(plan[plan.indexOf('--permission-mode') + 1], 'plan');
  assert.ok(!plan.includes('--yolo') && !plan.includes('--add-dir'));
  const scoped = commandArgs('m', [{ directory: 'C:\\shared' }]);
  assert.equal(scoped[scoped.indexOf('--add-dir') + 1], 'C:\\shared');
  assert.equal(scoped[scoped.indexOf('--permission-mode') + 1], 'plan');
  // plan mode would still block writes, so an unlimited grant drops it in favour of --yolo.
  const open = commandArgs('m', [{ all: true }]);
  assert.ok(open.includes('--yolo'));
  assert.ok(!open.includes('--permission-mode'));
  // Only the adapter that maps grants may raise an authorization request; the others keep denials as status text.
  assert.equal(adapterFor('command-cli').supportsGrants, true);
  assert.equal(adapterFor('claude-cli').supportsGrants, undefined);
});
test('Command CLI reports denied headless tools instead of a bare exit code', async t => {
  const status: string[] = [];
  const tools: import('../packages/providers/types').ProviderEvent[] = [];
  const parser = createCommandParser(e => { tools.push(e); if (e.type === 'status') status.push(e.text); });
  parser.push(event({ type: 'tool_queued', toolName: 'read_file', input: { file_path: '/outside/project.txt' } }) + event({ type: 'tool_denied', toolName: 'read_file' }) + result(''));
  parser.end();
  assert.match(status.join(''), /工具被拒绝：read_file/);
  // The queued frame reveals which file the model wanted, without echoing file bodies.
  assert.match(status.join(''), /调用工具：read_file \/outside\/project\.txt/);
  assert.deepEqual(tools.filter(entry => entry.type === 'tool'), [
    { type: 'tool', state: 'queued', name: 'read_file', detail: '/outside/project.txt' },
    { type: 'tool', state: 'denied', name: 'read_file', detail: '' },
  ]);

  const silent: string[] = [];
  const quiet = createCommandParser(e => { if (e.type === 'status') silent.push(e.text); });
  quiet.push(event({ type: 'tool_queued', toolName: 'write_file', input: { file_path: 'a.ts', content: 'SECRET BODY' } }) + result(''));
  quiet.end();
  assert.match(silent.join(''), /调用工具：write_file a\.ts/);
  assert.ok(!silent.join('').includes('SECRET BODY'));

  const cwd = await temporary(t); const executable = path.join(cwd, 'denied fixture.mjs');
  await writeFile(executable, `console.log(JSON.stringify({ type: 'event', event: { type: 'tool_queued', toolName: 'read_file', input: { file_path: '/outside/project.txt' } } }));
console.log(JSON.stringify({ type: 'event', event: { type: 'tool_denied', toolName: 'read_file' } }));
console.error('The model produced no response (continuation budget exhausted).');
process.exitCode = 9;
`);
  const emitted: string[] = [];
  await assert.rejects(
    adapterFor('command-cli').run({ config: { ...config, executable }, cwd, prompt: 'x', signal: AbortSignal.timeout(5000) }, e => { if (e.type !== 'tool') emitted.push(e.text); }),
    /进程退出码 9[\s\S]*continuation budget[\s\S]*被拒绝 1 次/,
  );
  assert.match(emitted.join(''), /调用工具：read_file \/outside\/project\.txt/);
});
test('Command default migration preserves existing connections and runs once', async t => {
  const dir = await temporary(t); const store = new Store(dir);
  store.state.providers.push({ ...config, kind: 'codex-cli', name: 'User provider' }); store.save();
  ensureDefaultProviders(store); assert.equal(store.state.providers.length, 3);
  assert.equal(store.state.providers[0].name, 'User provider');
  const id = store.state.providers.find(p => p.kind === 'command-cli')!.id;
  const reopened = new Store(dir); ensureDefaultProviders(reopened);
  assert.equal(reopened.state.providers.find(p => p.kind === 'command-cli')!.id, id);
  reopened.state.providers = reopened.state.providers.filter(p => p.id !== id); reopened.save();
  const deleted = new Store(dir); ensureDefaultProviders(deleted);
  assert.equal(deleted.state.providers.some(p => p.kind === 'command-cli'), false);
});
test('Command default migration does not duplicate a user configured cmdc', async t => {
  const dir = await temporary(t); const store = new Store(dir);
  store.state.providers.push({ ...config, executable: 'custom.mjs' }); ensureDefaultProviders(store);
  assert.equal(store.state.providers.filter(p => p.kind === 'command-cli').length, 1);
  assert.equal(store.state.providers[0].executable, 'custom.mjs');
  assert.equal(store.state.providers.length, 2);
  const fresh = new Store(path.join(dir, 'new')); ensureDefaultProviders(fresh);
  assert.equal(fresh.state.providers.length, 5);
});

test('model catalog parser accepts CLI rows and excludes headings/instructions', async () => {
  const { parseCommandModels } = await import('../packages/providers/models');
  assert.deepEqual(parseCommandModels('Available models  ·  3 models\nOpen Source\nfoo/bar-v1    reasoning (default)\nclaude-sonnet-test    recommended\nfoo/bar-v1    duplicate\nPass the full id, or short name:\ncmdc --model foo/bar-v1'), ['foo/bar-v1', 'claude-sonnet-test']);
});

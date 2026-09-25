import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { ProviderConfig, TerminalEvent } from '../packages/contracts';
import { Store } from '../packages/core/storage';
import { adapterFor } from '../packages/providers';
import { TerminalService, type PtyModule } from '../apps/desktop/terminal';

const base: ProviderConfig = { id: '00000000-0000-4000-8000-000000000031', name: 'cli', kind: 'command-cli', model: '', baseUrl: '', executable: '', timeoutMs: 10000 };
async function temporary(t: any) {
  const parent = path.resolve('.cache/tests'); await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(path.join(parent, 'terminal-'));
  t.after(async () => { assert.ok(dir.startsWith(parent + path.sep)); await rm(dir, { recursive: true, force: true }); });
  return dir;
}
function fakePty() {
  const written: string[] = []; const sizes: Array<[number, number]> = []; let killed = false;
  let data: ((chunk: string) => void) | undefined; let exit: ((event: { exitCode: number }) => void) | undefined;
  const exits: Array<(event: { exitCode: number }) => void> = [];
  const spawns: { file: string; args: string[]; cwd: string; term: string | undefined }[] = [];
  const module: PtyModule = {
    spawn(file, args, options) {
      spawns.push({ file, args, cwd: options.cwd, term: options.env.TERM });
      return {
        onData: callback => { data = callback; },
        onExit: callback => { exit = callback; exits.push(callback); },
        write: chunk => written.push(chunk),
        resize: (cols, rows) => sizes.push([cols, rows]),
        kill: () => { killed = true; exit?.({ exitCode: 0 }); },
      };
    },
  };
  return { module, spawns, written, sizes, isKilled: () => killed, push: (chunk: string) => data?.(chunk), close: (code: number) => exit?.({ exitCode: code }), closeAt: (index: number, code: number) => exits[index]?.({ exitCode: code }) };
}
async function service(t: any, injected: PtyModule | null, kind: ProviderConfig['kind'] = 'command-cli') {
  const dir = await temporary(t);
  const store = new Store(path.join(dir, 'state'));
  store.state.projects.push({ id: 'project', root: dir, name: 'test' });
  store.state.providers.push({ ...base, kind, id: 'p' });
  store.state.sessions.push({ id: 's', projectId: 'project', providerId: 'p', model: 'test-model', title: '新会话', messages: [], updatedAt: '' });
  const events: TerminalEvent[] = [];
  return { store, dir, events, terminal: new TerminalService(store, event => events.push(event), injected) };
}
test('interactive launch keeps the model and drops every headless flag', () => {
  assert.deepEqual(adapterFor('command-cli').interactive!({ ...base, model: 'm1' }).args, ['--model', 'm1', '--trust', '--skip-onboarding', '--no-auto-update']);
  assert.deepEqual(adapterFor('command-cli').interactive!({ ...base, model: '' }).args, ['--trust', '--skip-onboarding', '--no-auto-update']);
  assert.deepEqual(adapterFor('antigravity-cli').interactive!({ ...base, kind: 'antigravity-cli', model: 'm2' }).args, ['--model', 'm2']);
  assert.deepEqual(adapterFor('claude-cli').interactive!({ ...base, kind: 'claude-cli', model: 'sonnet' }).args, ['--model', 'sonnet']);
  assert.deepEqual(adapterFor('codex-cli').interactive!({ ...base, kind: 'codex-cli', model: 'gpt' }).args, ['-m', 'gpt']);
  assert.deepEqual(adapterFor('gemini-cli').interactive!({ ...base, kind: 'gemini-cli', model: '' }).args, []);
  const args = adapterFor('command-cli').interactive!({ ...base, model: 'm1' }).args;
  assert.ok(!args.includes('-p') && !args.includes('--output-format') && !args.includes('--permission-mode'));
  // API connections have no interactive CLI, so no terminal can be started for them.
  assert.equal(adapterFor('openai-api').interactive, undefined);
});
test('external console launch quotes arguments and refuses cmd metacharacters', async () => {
  const { consoleLine } = await import('../packages/providers/process');
  assert.equal(consoleLine(['cmdc', '--model', 'deepseek/v4-flash']), 'cmdc --model deepseek/v4-flash');
  assert.equal(consoleLine(['cmdc', '--model', 'a b']), 'cmdc --model "a b"');
  // A quoted & stays literal for cmd, but % and ! expand even inside quotes.
  assert.equal(consoleLine(['cmdc', '--model', 'a&calc']), 'cmdc --model "a&calc"');
  assert.equal(consoleLine(['cmdc', '--model', 'a"b']), 'cmdc --model "ab"');
  assert.throws(() => consoleLine(['cmdc', '--model', '%PATH%']), /特殊字符/);
  assert.throws(() => consoleLine(['cmdc', '--model', 'a!b']), /特殊字符/);
  assert.throws(() => consoleLine(['cmdc', '--model', 'a\nb']), /特殊字符/);
});
test('an interactive run resolves a real node runtime instead of the Electron binary', async () => {
  const { resolveNodeRuntime } = await import('../packages/providers/process');
  const original = process.env.PATH;
  process.env.PATH = '';
  await assert.rejects(resolveNodeRuntime(), /node/);
  process.env.PATH = original;
  const node = await resolveNodeRuntime();
  assert.match(path.basename(node), /^node(\.exe)?$/i);
});
test('terminal spawns the CLI in the project and forwards bytes both ways', async t => {
  const pty = fakePty();
  const { terminal, events, dir } = await service(t, pty.module);
  assert.deepEqual(await terminal.start('s'), { ok: true, message: '' });
  assert.equal(pty.spawns.length, 1);
  assert.equal(pty.spawns[0].cwd, dir);
  if (process.platform === 'win32') assert.equal(pty.spawns[0].term, 'dumb');
  // The head of the argv is the resolved runtime/script, which depends on how the CLI is installed.
  assert.deepEqual(pty.spawns[0].args.slice(-5), ['--model', 'test-model', '--trust', '--skip-onboarding', '--no-auto-update']);
  assert.equal(terminal.has('s'), true);
  // Starting twice is a no-op rather than a second CLI process.
  assert.equal((await terminal.start('s')).ok, true);
  assert.equal(pty.spawns.length, 1);
  pty.push('hello');
  terminal.write('s', 'typed');
  terminal.resize('s', 100, 40);
  assert.deepEqual(events, [{ sessionId: 's', type: 'data', data: 'hello' }]);
  assert.deepEqual(pty.written, ['typed']);
  assert.deepEqual(pty.sizes, [[100, 40]]);
  pty.close(0);
  assert.deepEqual(events.at(-1), { sessionId: 's', type: 'exit', data: '', exitCode: 0 });
  assert.equal(terminal.has('s'), false);
});
test('concurrent starts share one PTY and stopping during lookup cancels the stale start', async t => {
  const pty = fakePty();
  const { terminal, events } = await service(t, pty.module);
  const [first, second] = await Promise.all([terminal.start('s'), terminal.start('s')]);
  assert.equal(first.ok && second.ok, true);
  assert.equal(pty.spawns.length, 1);
  terminal.stop('s');
  await terminal.start('s');
  assert.equal(pty.spawns.length, 2);
  // A delayed exit from the old process must not remove the new PTY.
  pty.closeAt(0, 0);
  assert.equal(terminal.has('s'), true);
  assert.equal(events.filter(event => event.type === 'exit').length, 0);
});
test('stop while resolving CLI cancels first start without killing a later start', async t => {
  const pty = fakePty();
  const { terminal } = await service(t, pty.module);
  const stale = terminal.start('s');
  terminal.stop('s');
  const current = terminal.start('s');
  assert.equal((await stale).ok, false);
  assert.equal((await current).ok, true);
  assert.equal(pty.spawns.length, 1);
  terminal.write('s', 'FIRSTINPUT');
  assert.deepEqual(pty.written, ['FIRSTINPUT']);
});
test('terminal stop kills the process and unknown sessions are ignored', async t => {
  const pty = fakePty();
  const { terminal } = await service(t, pty.module);
  await terminal.start('s');
  terminal.write('missing', 'x');
  terminal.resize('missing', 10, 10);
  terminal.stop('missing');
  terminal.stop('s');
  assert.equal(pty.isKilled(), true);
  assert.equal(terminal.has('s'), false);
});
test('terminal reports a missing PTY component and a non-CLI connection', async t => {
  const missing = await service(t, null);
  const result = await missing.terminal.start('s');
  assert.equal(result.ok, false);
  assert.match(result.message, /node-pty/);

  const api = await service(t, fakePty().module, 'openai-api');
  const unsupported = await api.terminal.start('s');
  assert.equal(unsupported.ok, false);
  assert.match(unsupported.message, /CLI/);
});

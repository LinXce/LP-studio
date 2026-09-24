import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../packages/core/storage';
import { FileService, readSnapshot, resolveSafe, listFiles, hash } from '../packages/core/files';
async function fixture(t: any) {
  const parent = path.resolve('.cache/tests'); await mkdir(parent, { recursive: true }); const root = await mkdtemp(path.join(parent, 'files-'));
  t.after(async () => { assert.ok(root.startsWith(parent + path.sep)); await rm(root, { recursive: true, force: true }); });
  const project = path.join(root, 'project'); await mkdir(project); await writeFile(path.join(project, 'hello.ts'), 'const x = 1;\r\n');
  const store = new Store(path.join(root, 'state')); store.state.projects.push({ id: 'project', root: project, name: 'test' }); const files = new FileService(store);
  return { root, project, store, files };
}
test('apply and rollback preserve original bytes and survive restart', async t => {
  const { project, store, files } = await fixture(t); const before = await readSnapshot(project, 'hello.ts');
  const c = await files.propose('project', before, 'const x = 2;\n');
  await files.update(c.id, false); assert.equal(await readFile(path.join(project, 'hello.ts'), 'utf8'), 'const x = 2;\n');
  const reopened = new Store(store.dir); const service = new FileService(reopened); await service.update(c.id, true);
  assert.equal(await readFile(path.join(project, 'hello.ts'), 'utf8'), before.content); assert.equal(reopened.state.changes[0].state, 'rolled-back');
});
test('apply refuses a concurrent external edit', async t => {
  const { project, files } = await fixture(t); const c = await files.propose('project', await readSnapshot(project, 'hello.ts'), 'new');
  await writeFile(path.join(project, 'hello.ts'), 'external'); await assert.rejects(files.update(c.id, false), /外部修改/);
  assert.equal(await readFile(path.join(project, 'hello.ts'), 'utf8'), 'external');
});
test('rollback refuses to discard changes made after application', async t => {
  const { project, files } = await fixture(t); const c = await files.propose('project', await readSnapshot(project, 'hello.ts'), 'new'); await files.update(c.id, false);
  await writeFile(path.join(project, 'hello.ts'), 'later work'); await assert.rejects(files.update(c.id, true), /外部修改/);
});
test('rejects traversal, absolute paths, alternate streams and credentials', async t => {
  const { project } = await fixture(t); await writeFile(path.join(project, '.env'), 'SECRET');
  for (const relative of ['../state/workspace.json', '..\\outside', '/hello.ts', 'C:\\Windows\\win.ini', 'hello.ts:secret', '.env', '.git/config', '.ssh/id_rsa']) await assert.rejects(resolveSafe(project, relative));
  assert.equal((await listFiles(project, '')).some(e => e.name === '.env'), false);
});
test('rejects project junction traversal', async t => {
  const { project, root } = await fixture(t); const outside = path.join(root, 'outside'); await mkdir(outside); await writeFile(path.join(outside, 'secret'), 'secret');
  await symlink(outside, path.join(project, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readSnapshot(project, 'linked/secret'), /链接|junction/);
});
test('UTF-8 BOM round-trips and invalid encoding is rejected', async t => {
  const { project } = await fixture(t); const content = '\ufeff中文\r\n'; await writeFile(path.join(project, 'bom.txt'), content);
  assert.equal((await readSnapshot(project, 'bom.txt')).content, content);
  await writeFile(path.join(project, 'bad.txt'), Buffer.from([0xff, 0xfe, 0x41])); await assert.rejects(readSnapshot(project, 'bad.txt'), /UTF-8/);
});
test('recovery resolves crash after rename using content hash', async t => {
  const { project, files, store } = await fixture(t); const c = await files.propose('project', await readSnapshot(project, 'hello.ts'), 'new');
  c.state = 'applying'; store.save(); await writeFile(path.join(project, 'hello.ts'), c.after); await files.recover(); assert.equal(c.state, 'applied');
  c.state = 'rolling-back'; await writeFile(path.join(project, 'hello.ts'), c.before); await files.recover(); assert.equal(c.state, 'rolled-back');
});
test('forged proposal content and oversized binary changes are rejected', async t => {
  const { project, files } = await fixture(t); const s = await readSnapshot(project, 'hello.ts');
  await assert.rejects(files.propose('project', { ...s, content: 'forged' }, 'after'));
  await assert.rejects(files.propose('project', s, 'x\0y')); assert.equal(hash(s.content), s.hash);
});

// Selection belongs to the session, not the shared provider settings.
test('empty-session model choices persist independently and started/busy sessions reject changes', async t => {
  const { store } = await fixture(t);
  const { configureSession, sessionConfig } = await import('../packages/core/sessions');
  const provider = { id: 'p', kind: 'command-cli' as const, name: 'test', model: 'global', executable: '', baseUrl: '', timeoutMs: 10000 };
  store.state.providers.push(provider, { ...provider, id: 'q', model: 'other' });
  store.state.sessions.push({ id: 'a', projectId: 'project', providerId: 'p', title: '新会话', messages: [], updatedAt: '' }, { id: 'b', projectId: 'project', providerId: 'p', model: '', title: '新会话', messages: [], updatedAt: '' });
  assert.equal(sessionConfig(store, 'a').model, 'global');
  assert.equal(sessionConfig(store, 'b').model, '');
  configureSession(store, 'a', 'q', 'chosen', false);
  assert.equal(new Store(store.dir).session('a').model, 'chosen');
  assert.equal(store.provider('q').model, 'other');
  assert.equal(store.session('b').providerId, 'p');
  assert.throws(() => configureSession(store, 'a', 'p', 'bad', true), /等待/);
  store.session('a').startedAt = new Date().toISOString();
  assert.throws(() => configureSession(store, 'a', 'p', 'bad', false), /新建会话/);
  store.session('b').messages.push({ id: 'm', role: 'user', text: 'legacy conversation', time: '' });
  assert.throws(() => configureSession(store, 'b', 'q', '', false), /新建会话/);
});

test('run captures session model before async execution and passes it to CLI', async t => {
  const { store, files, root } = await fixture(t);
  const { Runs } = await import('../packages/core/runs');
  const executable = path.join(root, 'model-fixture.mjs');
  await writeFile(executable, `import assert from 'node:assert/strict';
    assert.equal(process.argv[process.argv.indexOf('--model') + 1], 'selected-model');
    let input = ''; for await (const chunk of process.stdin) input += chunk;
    assert.ok(input.includes('check selection'), 'prompt carries the request');
    assert.equal(input, 'check selection', 'a first plain message goes through untouched');
    console.log(JSON.stringify({type:'result', subtype:'success', finalText:'model-ok'}));`);
  store.state.providers.push({ id: 'p', kind: 'command-cli', name: 'test', model: 'global-model', executable, baseUrl: '', timeoutMs: 10000 });
  store.state.sessions.push({ id: 's', projectId: 'project', providerId: 'p', model: 'selected-model', title: '新会话', messages: [], updatedAt: '' });
  const events: import('../packages/contracts').StreamEvent[] = [];
  let done!: () => void; const finished = new Promise<void>(resolve => { done = resolve; });
  const runs = new Runs(store, files, async () => undefined, event => { events.push(event); if (event.type === 'done') done(); });
  runs.start({ sessionId: 's', prompt: 'check selection', context: [] });
  assert.ok(store.session('s').startedAt);
  store.provider('p').model = 'changed-global';
  await finished;
  assert.equal(events.some(e => e.type === 'error'), false, JSON.stringify(events));
  assert.equal(store.session('s').messages.at(-1)?.text, 'model-ok');
  assert.equal(new Store(store.dir).session('s').model, 'selected-model');
});
test('a denied tool becomes an in-stream authorization that the grant then resolves', async t => {
  const { store, files, root, project } = await fixture(t);
  const { Runs, grantForDenial, sameGrant, editInstructions, buildPrompt } = await import('../packages/core/runs');
  const outside = path.join(root, 'outside'); await mkdir(outside); await writeFile(path.join(outside, 'shared.ts'), 'export const shared = 1;\n');
  const target = path.join(outside, 'shared.ts');
  const executable = path.join(root, 'deny-fixture.mjs');
  await writeFile(executable, `console.log(JSON.stringify({ type: 'event', event: { type: 'tool_queued', toolName: 'read_file', input: { file_path: ${JSON.stringify(target)} } } }));
console.log(JSON.stringify({ type: 'event', event: { type: 'tool_denied', toolName: 'read_file' } }));
console.log(JSON.stringify({ type: 'result', subtype: 'success', finalText: '' }));
`);
  store.state.providers.push({ id: 'p', kind: 'command-cli', name: 'test', model: 'm', executable, baseUrl: '', timeoutMs: 10000 });
  store.state.sessions.push({ id: 's', projectId: 'project', providerId: 'p', model: 'm', title: '新会话', messages: [], updatedAt: '' });
  const run = async (prompt: string, retry = false) => {
    const events: import('../packages/contracts').StreamEvent[] = [];
    let done!: () => void; const finished = new Promise<void>(resolve => { done = resolve; });
    new Runs(store, files, async () => undefined, event => { events.push(event); if (event.type === 'done') done(); }).start({ sessionId: 's', prompt, context: [], retry });
    await finished; return events;
  };
  const first = await run('read the shared file');
  const authorize = first.find(event => event.authorize)?.authorize;
  assert.ok(authorize, JSON.stringify(first));
  assert.equal(authorize.tool, 'read_file');
  assert.equal(authorize.detail, target);
  assert.deepEqual(authorize.grant, { directory: outside });
  assert.equal(authorize.prompt, 'read the shared file');

  // A grant that did not help escalates instead of going silent, and only the last step reports the run as stuck.
  store.session('s').grants = [{ directory: outside }];
  const second = await run('read it again');
  const escalated = second.find(event => event.authorize)?.authorize;
  assert.deepEqual(escalated?.grant, { all: true });
  assert.match(escalated!.description, /已授权/);

  store.session('s').grants = [{ all: true }];
  const third = await run('read it again');
  assert.equal(third.some(event => event.authorize), false);
  assert.match(third.filter(event => event.type === 'status').map(event => event.text).join(''), /已授权全部工具仍被拒绝/);

  // Only a real directory outside the project earns a directory grant; everything else needs the broad one.
  assert.deepEqual(grantForDenial(project, '/nope/missing.ts'), { all: true });
  assert.deepEqual(grantForDenial(project, 'hello.ts'), { all: true });
  assert.deepEqual(grantForDenial(project, target), { directory: outside });
  assert.equal(sameGrant({ directory: 'a' }, { directory: 'a' }), true);
  assert.equal(sameGrant({ directory: 'a' }, { all: true }), false);

  // A retry replaces the abandoned answer and the prompt, so the transcript keeps one bubble per turn.
  const before = { assistant: store.session('s').messages.filter(m => m.role === 'assistant').length, user: store.session('s').messages.filter(m => m.role === 'user').length };
  await run('read it again', true);
  assert.equal(store.session('s').messages.filter(m => m.role === 'assistant').length, before.assistant);
  assert.equal(store.session('s').messages.filter(m => m.role === 'user').length, before.user);

  // The prompt must describe the granted scope, not claim there are no tools.
  assert.match(editInstructions([]), /本次运行只允许读取文件/);
  assert.match(editInstructions([{ all: true }]), /本会话已获授权使用全部工具/);
  assert.match(editInstructions([{ directory: 'C:\\x' }]), /本次运行只允许读取文件/);

  // A plain first message is sent verbatim, so a question is not dressed up as a coding task.
  assert.equal(buildPrompt({ grants: [], history: [], context: [], request: 'return 1' }), 'return 1');
  assert.deepEqual(JSON.parse(buildPrompt({ grants: [], history: [{ role: 'user', content: 'hi' }], context: [], request: 'return 1' })), { history: [{ role: 'user', content: 'hi' }], context: [], request: 'return 1' });
  const withFile = buildPrompt({ grants: [], history: [], context: [{ path: 'a.ts', content: 'x' }], request: 'edit' });
  assert.match(withFile, /^你在 LP Studio 中协助用户。/);
  assert.match(withFile, /lp-edit/);
});


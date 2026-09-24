import { _electron as electron } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'node:http';
import { checkPanelToggles } from './panel-checks.mjs';
const root = process.cwd();
const runDir = path.join(root, '.cache', `desktop-smoke-${Date.now()}`);
const project = path.join(runDir, 'sample-project'); await mkdir(project, { recursive: true });
const before = 'export const greeting = "Hello, LP Studio";\n';
await writeFile(path.join(project, 'greeting.ts'), before); await writeFile(path.join(project, 'README.md'), '# Sample project\n');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(root, 'dist/main/main.cjs')], cwd: runDir, env });
// Surface main-process output so a crash inside Electron is not silent.
app.process().stdout?.on('data', chunk => process.stdout.write(`[app] ${chunk}`));
app.process().stderr?.on('data', chunk => process.stdout.write(`[app] ${chunk}`));
const errors = [];
const modelReply = '已检查 `greeting.ts`，这是待审核的修改。\n```lp-edit\n' + JSON.stringify({ path: 'greeting.ts', content: 'export const greeting = "AI reviewed change";\n' }) + '\n```';
let finishReply;
const replyGate = new Promise(resolve => { finishReply = resolve; });
const server = createServer(async (req, res) => {
  for await (const _ of req) { /* consume */ }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: modelReply.slice(0, 15) } }] }) + '\n\n');
  await replyGate;
  if (res.destroyed) return;
  res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: modelReply.slice(15) } }] }) + '\n\ndata: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const apiUrl = `http://127.0.0.1:${server.address().port}/v1`;
try {
  const page = await app.firstWindow(); page.on('pageerror', err => errors.push(err.message));
  await page.getByRole('heading', { name: '在终端里直接用 CLI' }).waitFor();
  // The terminal replaced the conversation view: the empty state carries the CLI/model pickers.
  assert.equal(await page.locator('.terminal-empty').isVisible(), true);
  assert.equal(await page.getByRole('textbox', { name: '对话输入' }).count(), 0);
  await page.locator('.terminal-empty').getByRole('button', { name: '新建会话', exact: true }).waitFor();
  // Exercise the themed UI confirmation rather than replacing native message boxes.
  await page.exposeFunction('acceptSmokeConfirmation', async () => { await page.locator('.confirmation-dialog[open]').getByRole('button', { name: '确认', exact: true }).click(); });
  await page.addInitScript(() => { window.addEventListener('DOMContentLoaded', () => window.studio.onConfirm(() => { void window.acceptSmokeConfirmation(); })); });
  await page.evaluate(() => window.studio.onConfirm(() => { void window.acceptSmokeConfirmation(); }));
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await app.evaluate(({ dialog }, project) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });

  }, project);
  await page.getByRole('button', { name: '打开本地项目' }).click();
  await page.getByRole('button', { name: 'greeting.ts', exact: true }).click();
  await page.locator('.monaco-editor').first().waitFor();
  const state = await page.evaluate(() => window.studio.bootstrap()); const projectId = state.projects[0].id;
  const session = await page.evaluate(({ projectId, providerId }) => window.studio.createSession(projectId, providerId), { projectId, providerId: state.providers[0].id });
  const result = await page.evaluate(async ({ projectId, sessionId }) => {
    const snap = await window.studio.readFile(projectId, 'greeting.ts');
    const change = await window.studio.propose(projectId, snap, 'export const greeting = "Reviewed change";\n');
    await window.studio.apply(change.id);
    const applied = await window.studio.readFile(projectId, 'greeting.ts');
    await window.studio.rollback(change.id);
    const restored = await window.studio.readFile(projectId, 'greeting.ts');
    const events = []; const stop = window.studio.onEvent(e => events.push(e));
    await window.studio.command(sessionId, 'Write-Output "DESKTOP_SMOKE_OK"');
    await new Promise((resolve, reject) => { const start = Date.now(); const poll = setInterval(() => { if (events.some(e => e.type === 'done')) { clearInterval(poll); resolve(); } else if (Date.now() - start > 15000) { clearInterval(poll); reject(Error('command timeout')); } }, 30); });
    stop(); return { applied: applied.content, restored: restored.content, events };
  }, { projectId, sessionId: session.id });
  assert.match(result.applied, /Reviewed change/); assert.equal(result.restored, before);
  assert.ok(result.events.some(e => e.text.includes('DESKTOP_SMOKE_OK'))); assert.ok(!result.events.some(e => e.type === 'error'));
  const secretId = randomUUID(); const secret = 'smoke-secret-never-store-plaintext';
  await page.evaluate(({ id, secret, apiUrl }) => window.studio.saveProvider({ id, name: 'Test API', kind: 'openai-api', model: 'test', executable: '', baseUrl: apiUrl, timeoutMs: 10000 }, secret), { id: secretId, secret, apiUrl });
  const secretFile = await readFile(path.join(runDir, '.lp-data', 'secrets.json'), 'utf8'); assert.ok(!secretFile.includes(secret));
  const apiSession = await page.evaluate(({ projectId, providerId }) => window.studio.createSession(projectId, providerId), { projectId, providerId: secretId });
  await page.reload();
  await page.getByRole('button', { name: 'greeting.ts', exact: true }).click(); await page.locator('.monaco-editor').first().waitFor();
  await checkPanelToggles(page);
  const commandProvider = state.providers.find(p => p.kind === 'command-cli');
  assert.ok(commandProvider, 'Command CLI seeded into a new workspace');
  const nav = name => page.locator('.rail').getByRole('button', { name, exact: true });
  await nav('终端命令').click();
  await page.getByRole('textbox', { name: '终端命令', exact: true }).fill('Write-Output "draft"');
  await nav('模型与 API Key').click();
  await page.getByRole('heading', { name: '模型与连接' }).waitFor();
  assert.equal(await page.locator('.modal-backdrop, [role="dialog"]').count(), 0);
  assert.equal(await page.getByLabel('CLI 终端').isVisible(), false);
  assert.equal(await page.getByLabel('终端工作区').isVisible(), false);
  assert.equal(await page.locator('.central-workspace .models-page').isVisible(), true);
  assert.equal(await page.locator('.project-panel').isVisible(), true);
  assert.equal(await page.locator('.preview-panel').isVisible(), true);
  assert.equal(await nav('模型与 API Key').getAttribute('aria-pressed'), 'true');
  const modelName = page.getByRole('textbox', { name: '连接名称', exact: true });
  await modelName.fill('未保存的模型草稿');
  await nav('设置').click();
  await page.getByRole('heading', { name: '工作台设置' }).waitFor();
  assert.equal(await page.locator('.models-page').isVisible(), false);
  assert.equal(await page.locator('.workspace-view:not([hidden])').evaluate(el => getComputedStyle(el).animationName), 'workspace-enter');
  await page.getByRole('button', { name: '工业浅色主题', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'industrial');
  assert.equal(await page.locator('.project-panel').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(237, 240, 233)');
  await page.locator('.monaco-editor.vs').first().waitFor();
  await nav('终端').click(); await checkPanelToggles(page);
  await nav('模型与 API Key').click(); assert.equal(await modelName.inputValue(), '未保存的模型草稿');
  // Narrow center columns must scroll vertically, without hiding form controls horizontally.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 760));
  await page.waitForFunction(() => window.innerWidth <= 1100);
  assert.equal(await page.locator('.page-scroll:not([hidden])').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
  await page.getByRole('button', { name: '保存连接', exact: true }).scrollIntoViewIfNeeded();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1520, 960));
  await nav('会话').click(); await page.getByRole('heading', { name: '会话', exact: true }).waitFor();
  await page.getByRole('textbox', { name: '搜索会话' }).fill('不存在的会话');
  await page.getByRole('heading', { name: '没有匹配的会话' }).waitFor();
  await page.getByRole('textbox', { name: '搜索会话' }).fill('');
  assert.equal(await page.locator('.session-card').count(), 2);
  await nav('终端命令').click(); assert.equal(await page.getByRole('textbox', { name: '终端命令', exact: true }).inputValue(), 'Write-Output "draft"');
  await nav('终端').click(); await page.locator('.terminal-view, .terminal-empty').first().waitFor();
  await nav('设置').click(); await page.keyboard.press('Control+l');
  assert.equal(await page.locator('.settings-page').isVisible(), false);
  await page.reload(); await nav('设置').click();
  assert.equal(await page.getByRole('button', { name: '工业浅色主题', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await nav('模型与 API Key').click();
  assert.equal(await page.locator('.workspace-view:not([hidden])').evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // The conversation UI is hidden in this build, so the headless run is driven through the bridge.
  await page.evaluate(({ sessionId }) => { window.studio.run({ sessionId, prompt: '请检查 greeting.ts 并提出修改。', context: ['greeting.ts'] }).catch(error => { window.runError = String(error); }); }, { sessionId: apiSession.id });
  await nav('会话').click();
  await page.waitForFunction(() => window.runError || document.querySelector('.session-running'), undefined, { timeout: 15000 });
  assert.equal(await page.evaluate(() => window.runError ?? ''), '');
  await page.locator('.session-running').waitFor();
  await nav('模型与 API Key').click();
  finishReply();
  await page.waitForFunction(async () => (await window.studio.bootstrap()).changes.some(c => c.state === 'pending'));
  assert.equal(await page.evaluate(() => window.runError ?? ''), '');
  const afterRun = await page.evaluate(() => window.studio.bootstrap());
  assert.ok(afterRun.changes.some(c => c.state === 'pending' && c.after.includes('AI reviewed')));
  assert.equal(await readFile(path.join(project, 'greeting.ts'), 'utf8'), before);
  await page.locator('.session-row .session-open').first().click();
  await nav('终端命令').click();
  await page.getByRole('button', { name: /greeting.ts 审核 diff/ }).waitFor({ timeout: 15000 });
  assert.ok((await page.locator('.message.assistant').allInnerTexts()).join(' ').includes('待审核的修改'));
  await page.getByRole('button', { name: /greeting.ts 审核 diff/ }).click();
  await page.locator('.monaco-diff-editor').waitFor();
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await page.screenshot({ animations: 'disabled', path: path.join(root, 'docs', 'theme-industrial.png') });
  await nav('设置').click();
  await page.screenshot({ animations: 'disabled', path: path.join(root, 'docs', 'theme-settings.png') });
  await page.getByRole('button', { name: '午夜深蓝主题', exact: true }).click();
  await page.locator('.monaco-editor.vs-dark').first().waitFor();
  await nav('终端').click();
  await page.screenshot({ animations: 'disabled', path: path.join(root, 'docs', 'desktop-preview.png') });
  // Exercise the new adapter through desktop IPC, without calling a paid account.
  const commandFixture = path.join(runDir, 'cmdc-fixture.mjs');
  await writeFile(commandFixture, `import assert from 'node:assert/strict';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('cmdc fixture 1.0'); process.exit(0); }
if (args.includes('--list-models')) { console.log('Available models\\nfixture/model-a    reasoning\\nfixture/model-b    fast'); process.exit(0); }
assert.equal(args[args.indexOf('--model') + 1], 'fixture/model-b');
assert.equal(args[args.indexOf('--permission-mode') + 1], 'plan');
assert.equal(args[args.indexOf('--output-format') + 1], 'json');
process.stdin.setEncoding('utf8'); let input = ''; for await (const c of process.stdin) input += c;
assert.ok(input.includes('检查 cmdc 接入')); assert.ok(input.includes('greeting.ts'));
const text = 'COMMAND_CLI_DESKTOP_OK';
console.log(JSON.stringify({ type: 'event', event: { type: 'text_delta', delta: text } }));
console.log(JSON.stringify({ type: 'result', subtype: 'success', finalText: text }));
`);
  await page.evaluate(({ config, executable }) => window.studio.saveProvider({ ...config, executable }), { config: commandProvider, executable: commandFixture });
  await page.reload();
  await nav('模型与 API Key').click();
  await page.locator('.model-item').filter({ hasText: 'Command CLI (cmdc)' }).click();
  assert.equal(await page.getByLabel(/^适配器/).inputValue(), 'command-cli');
  await page.getByRole('button', { name: '检测已保存连接', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.probe-result')?.textContent.includes('cmdc fixture 1.0'));
  const listed = await page.evaluate(id => window.studio.providerModels(id, true), commandProvider.id);
  assert.ok(listed.models.includes('fixture/model-b'));
  await nav('终端命令').click();
  await page.evaluate(({ projectId, providerId }) => window.studio.createSession(projectId, providerId, 'fixture/model-b')
    .then(session => window.studio.run({ sessionId: session.id, prompt: '检查 cmdc 接入', context: ['greeting.ts'] }))
    .catch(error => { window.runError = String(error); }), { projectId: state.projects[0].id, providerId: commandProvider.id });
  await page.waitForFunction(async () => (await window.studio.bootstrap()).sessions.some(s => s.messages.some(m => m.role === 'assistant' && m.text === 'COMMAND_CLI_DESKTOP_OK')));
  assert.equal(await page.evaluate(() => window.runError ?? ''), '');
  // Wait for the renderer to learn about the bridge-created session before selecting it by title.
  const cmdcRow = page.locator('.session-row').filter({ hasText: '检查 cmdc 接入' }).locator('.session-open');
  await cmdcRow.waitFor({ timeout: 15000 });
  await cmdcRow.click();
  await nav('终端命令').click();
  await page.locator('.message.assistant .message-text').filter({ hasText: 'COMMAND_CLI_DESKTOP_OK' }).first().waitFor();
  // The message text lands before the run is torn down; wait for the send button to come back.
  await page.getByRole('button', { name: '运行 · Enter' }).waitFor({ timeout: 20000 });
  // A denied CLI tool appears as an in-stream authorization bubble; approving retries the turn with the grant.
  const denyFixture = path.join(runDir, 'cmdc-deny.mjs');
  await writeFile(denyFixture, `import assert from 'node:assert/strict';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('cmdc fixture 1.0'); process.exit(0); }
assert.ok(args.includes('-p'));
const granted = args.includes('--yolo');
if (granted) assert.ok(!args.includes('--permission-mode'));
if (!granted) {
  console.log(JSON.stringify({ type: 'event', event: { type: 'tool_queued', toolName: 'read_file', input: { file_path: '/outside/does-not-exist.ts' } } }));
  console.log(JSON.stringify({ type: 'event', event: { type: 'tool_denied', toolName: 'read_file' } }));
}
process.stdin.setEncoding('utf8'); for await (const chunk of process.stdin) {}
const text = granted ? 'GRANTED_RETRY_OK' : '';
console.log(JSON.stringify({ type: 'event', event: { type: 'text_delta', delta: text } }));
console.log(JSON.stringify({ type: 'result', subtype: 'success', finalText: text }));
`);
  await page.evaluate(({ config, executable }) => window.studio.saveProvider({ ...config, executable }), { config: commandProvider, executable: denyFixture });
  const denied = await page.evaluate(({ projectId, providerId }) => window.studio.createSession(projectId, providerId), { projectId: state.projects[0].id, providerId: commandProvider.id });
  await page.reload();
  await page.locator('.session-row .session-open').first().click();
  await nav('终端命令').click();
  await page.evaluate(({ sessionId }) => { window.studio.run({ sessionId, prompt: '读取工作区外的文件', context: [] }).catch(error => { window.runError = String(error); }); }, { sessionId: denied.id });
  // Runs start without a confirmation dialog, so no approval prompt should appear.
  assert.equal(await page.locator('.confirmation-dialog[open]').count(), 0);
  const bubble = page.locator('.message.authorize');
  await bubble.waitFor({ timeout: 20000 });
  assert.match(await bubble.innerText(), /允许本会话使用全部工具/);
  await bubble.getByRole('button', { name: '忽略', exact: true }).click();
  assert.equal(await page.locator('.message.authorize').count(), 0);
  await page.evaluate(({ sessionId }) => { window.studio.run({ sessionId, prompt: '再试一次', context: [] }).catch(error => { window.runError = String(error); }); }, { sessionId: denied.id });
  await page.locator('.message.authorize').waitFor({ timeout: 20000 });
  await page.locator('.message.authorize').getByRole('button', { name: '允许并重新执行', exact: true }).click();
  await page.locator('.message.assistant .message-text').filter({ hasText: 'GRANTED_RETRY_OK' }).first().waitFor({ timeout: 30000 });
  assert.equal(await page.locator('.message.authorize').count(), 0);
  const stored = await page.evaluate(() => window.studio.bootstrap());
  assert.deepEqual(stored.sessions.find(s => s.id === stored.sessions.at(-1).id).grants, [{ all: true }]);
  assert.equal(await readFile(path.join(project, 'greeting.ts'), 'utf8'), before);
  // The embedded terminal runs the CLI through a real PTY: bytes flow both ways end to end.
  const ttyFixture = path.join(runDir, 'tty-fixture.mjs');
  await writeFile(ttyFixture, `process.stdout.write('TTY_READY\\r\\n');\nprocess.stdin.setEncoding('utf8');\nprocess.stdin.on('data', chunk => process.stdout.write('ECHO:' + chunk.replace(/[\\r\\n]/g, '')));\n`);
  const codex = (await page.evaluate(() => window.studio.bootstrap())).providers.find(entry => entry.kind === 'codex-cli');
  await page.evaluate(({ config, executable }) => window.studio.saveProvider({ ...config, executable }), { config: codex, executable: ttyFixture });
  const ttySession = await page.evaluate(({ projectId, providerId }) => window.studio.createSession(projectId, providerId), { projectId: state.projects[0].id, providerId: codex.id });
  await page.reload();
  const ttyRow = page.locator('.session-row').filter({ hasText: '新会话' }).first();
  await ttyRow.waitFor({ timeout: 15000 });
  await ttyRow.locator('.session-open').click();
  await page.locator('.terminal-host').waitFor({ timeout: 20000 });
  assert.equal(await page.locator('.terminal-host').isVisible(), true);
  assert.equal(await page.locator('.terminal-notice').count(), 0);
  // Session tabs live in the terminal view itself.
  assert.ok(await page.locator('.terminal-view > .tabs .session-tab').count() > 0);
  // A TUI ignores stdin for seconds after spawn, so the renderer queues input until the CLI goes quiet.
  await page.locator('.terminal-boot').waitFor({ timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector('.terminal-boot'), undefined, { timeout: 20000 });
  // Type through the real UI path (keyboard -> xterm -> IPC -> PTY) and collect the echo.
  await page.evaluate(() => { window.ttySeen = []; window.ttyStop = window.studio.onTerminal(event => window.ttySeen.push(event.data)); });
  await page.locator('.terminal-host').click();
  await page.keyboard.type('hello');
  await page.keyboard.press('Enter');
  const echoed = await page.evaluate(async () => {
    const start = Date.now();
    while (!window.ttySeen.join('').includes('ECHO:hello') && Date.now() - start < 15000) await new Promise(resolve => setTimeout(resolve, 100));
    window.ttyStop();
    return window.ttySeen.join('');
  });
  assert.match(echoed, /TTY_READY|ECHO:hello/);
  assert.match(echoed, /ECHO:hello/, `typed input did not reach the PTY: ${JSON.stringify(echoed.slice(0, 200))}`);
  // Composition is handled by the renderer, not xterm: the committed text lands exactly once, the
  // composing keystrokes never reach the CLI, and a cancelled composition does not latch.
  await page.evaluate(() => { window.imeSeen = []; window.imeStop = window.studio.onTerminal(event => window.imeSeen.push(event.data)); });
  const compose = steps => page.evaluate(steps => {
    const area = document.querySelector('.xterm-helper-textarea');
    for (const [type, data] of steps) {
      if (type === 'keydown') { area.dispatchEvent(new KeyboardEvent('keydown', { key: data, keyCode: 229, isComposing: true, bubbles: true })); continue; }
      // The first keystroke of a Windows IME arrives before compositionstart, flagged 229 but not composing.
      if (type === 'keydown229') { area.dispatchEvent(new KeyboardEvent('keydown', { key: data, keyCode: 229, isComposing: false, bubbles: true })); continue; }
      if (type === 'compositionupdate') { area.value = data; area.dispatchEvent(new InputEvent('input', { bubbles: true, data, isComposing: true })); }
      if (type === 'compositionend') {
        area.value = data;
        area.dispatchEvent(new CompositionEvent(type, { bubbles: true, data }));
        // Chromium follows the commit with a non-composing input event in the same task.
        area.dispatchEvent(new InputEvent('input', { bubbles: true, data, isComposing: false }));
      }
      if (type !== 'compositionupdate' && type !== 'compositionend') area.dispatchEvent(new CompositionEvent(type, { bubbles: true, data }));
    }
  }, steps);
  await compose([['keydown229', 'j'], ['compositionstart', ''], ['compositionupdate', 'jia'], ['compositionend', '家']]);
  await new Promise(resolve => setTimeout(resolve, 400));
  await page.keyboard.press('Enter');
  await new Promise(resolve => setTimeout(resolve, 300));
  await compose([['compositionstart', ''], ['compositionupdate', 'nihao'], ['keydown', 'n'], ['compositionend', '你好']]);
  // A human picks a candidate and only then presses Enter.
  await new Promise(resolve => setTimeout(resolve, 400));
  await page.keyboard.press('Enter');
  await new Promise(resolve => setTimeout(resolve, 300));
  // Control: a plain write in the very same session must still arrive intact after a composition.
  await page.evaluate(id => window.studio.terminalWrite(id, 'control\r'), ttySession.id);
  // A composition the user cancels must not latch, so typing has to keep working afterwards.
  await compose([['compositionstart', ''], ['compositionupdate', 'shijie'], ['keydown', 's'], ['compositionend', '']]);
  await page.locator('.terminal-host').click();
  await page.keyboard.type('after');
  await page.keyboard.press('Enter');
  const imeSeen = await page.evaluate(async () => {
    const start = Date.now();
    while (!window.imeSeen.join('').includes('ECHO:after') && Date.now() - start < 15000) await new Promise(resolve => setTimeout(resolve, 100));
    window.imeStop(); return window.imeSeen.join('');
  });
  // ConPTY repaints can retract the raw echo, so assert on the bytes and on the rendered screen.
  const imeText = `${imeSeen}\n${await page.locator('.terminal-host').innerText()}`;
  // The keystroke that opens a composition must never reach the CLI, and must not duplicate on commit.
  assert.equal(imeText.includes('ECHO:j'), false, `the first IME keystroke leaked into the CLI: ${JSON.stringify(imeText.slice(0, 200))}`);
  assert.equal(/jia/.test(imeText), false, `pinyin leaked into the CLI: ${JSON.stringify(imeText.slice(0, 200))}`);
  assert.match(imeText, /家/, `committed composition never reached the PTY: ${JSON.stringify(imeText.slice(0, 200))}`);
  assert.equal(imeText.includes('家家'), false, `the commit was delivered twice: ${JSON.stringify(imeText.slice(0, 200))}`);
  assert.match(imeText, /ECHO:control/, `plain writes stopped working after a composition: ${JSON.stringify(imeText.slice(0, 200))}`);
  assert.equal(/nihao|shijie/.test(imeText), false, `composing keys leaked to the CLI: ${JSON.stringify(imeText.slice(0, 200))}`);
  assert.match(imeText, /ECHO:after/, `typing after a cancelled composition was dropped: ${JSON.stringify(imeText.slice(0, 200))}`);
  assert.deepEqual(errors, []);
  console.log('Electron smoke passed: native window, isolated renderer, file tree, Monaco, context, apply/rollback, PowerShell, encrypted vault, shortcuts, embedded navigation, draft retention, background streaming, panel geometry and retained toggle, Command CLI integration, narrow layout, themes, persistence, reduced motion.');
} finally { finishReply(); server.closeAllConnections(); server.close(); await app.close(); }

// Window chrome and destructive session actions are part of desktop regression.
await import('./chrome-smoke.mjs');

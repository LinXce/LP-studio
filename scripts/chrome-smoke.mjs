import { _electron as electron } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd();
const cwd = path.join(root, '.cache', `chrome-smoke-${Date.now()}`);
const project = path.join(cwd, 'project'); await mkdir(project, { recursive: true });
await writeFile(path.join(project, 'sample.ts'), 'export const sample = 1;\n');
const gitRun = args => new Promise((resolve, reject) => execFile('git', args, { cwd: project, windowsHide: true }, (error, _stdout, stderr) => error ? reject(Error(String(stderr).trim() || error.message)) : resolve()));
const gitReady = await new Promise(resolve => execFile('git', ['--version'], { windowsHide: true }, error => resolve(!error)));
// The sample project is its own repository, so the badge must not resolve the outer workbench tree.
if (gitReady) {
  await gitRun(['init', '-b', 'main']);
  await gitRun(['-c', 'user.name=LP Smoke', '-c', 'user.email=smoke@example.com', 'add', '-A']);
  await gitRun(['-c', 'user.name=LP Smoke', '-c', 'user.email=smoke@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'init']);
  await gitRun(['branch', 'feature']);
}
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(root, 'dist/main/main.cjs')], cwd, env });
let closed = false;
try {
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.locator('.window-controls').waitFor();
  const openConsoleEarly = () => page.locator('.rail').getByRole('button', { name: '终端命令', exact: true }).click();
  assert.ok(await page.locator('.window-controls').evaluate(el => {
    const rect = el.getBoundingClientRect(); const close = el.querySelector('.window-close').getBoundingClientRect();
    return Math.abs(rect.right - innerWidth) < 2 && Math.abs(close.right - innerWidth) < 2 && rect.top === 0;
  }));
  await page.getByRole('button', { name: '新建会话', exact: true }).first().click();
  await page.getByRole('alert').waitFor();
  // The bottom notice carries its severity, and the palette follows the theme.
  assert.equal(await page.getByRole('alert').getAttribute('class'), 'toast warning');
  const noticeColors = () => page.evaluate(() => ['info', 'success', 'warning', 'error'].map(level => { const el = document.createElement('div'); el.className = `toast ${level}`; document.body.appendChild(el); const style = getComputedStyle(el); const colors = [style.backgroundColor, style.borderColor, style.color]; el.remove(); return `${level}:${colors.join('|')}`; }));
  const midnightNotice = await noticeColors();
  assert.equal(new Set(midnightNotice.map(entry => entry.split(':')[1])).size, 4);
  // Advance the renderer clock so repeat notices get a fresh four seconds.
  await page.clock.install();
  await page.getByRole('button', { name: '新建会话', exact: true }).first().click();
  await page.clock.fastForward(3000);
  await page.getByRole('button', { name: '新建会话', exact: true }).first().click();
  await page.clock.fastForward(3000); assert.equal(await page.getByRole('alert').count(), 1);
  await page.clock.fastForward(1100); assert.equal(await page.getByRole('alert').count(), 0);
  await page.clock.resume();
  // The conversation input is hidden in this build, so the composer behaviour is checked on the command input.
  await openConsoleEarly();
  const composer = page.getByRole('textbox', { name: '终端命令', exact: true });
  await composer.fill('第一行');
  await composer.press('Shift+Enter');
  await composer.pressSequentially('第二行');
  assert.equal(await composer.inputValue(), '第一行\n第二行');
  await composer.press('Enter');
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /请先打开项目/);
  await composer.fill('');

  await app.evaluate(({ dialog }, project) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] }); }, project);
  await page.getByRole('button', { name: '打开项目', exact: true }).click();
  await page.waitForFunction(async () => (await window.studio.bootstrap()).projects.length === 1);
  const state = await page.evaluate(() => window.studio.bootstrap());
  const ids = await page.evaluate(async ({ projectId, providerId }) => {
    const a = await window.studio.createSession(projectId, providerId);
    const b = await window.studio.createSession(projectId, providerId);
    const snapshot = await window.studio.readFile(projectId, 'sample.ts');
    const change = await window.studio.propose(projectId, snapshot, 'export const sample = 2;\n');
    return { a: a.id, b: b.id, change: change.id };
  }, { projectId: state.projects[0].id, providerId: state.providers[0].id });
  // The conversation view is hidden in this build; the CLI/model pickers and git badge live in the command panel.
  const openConsole = () => page.locator('.rail').getByRole('button', { name: '终端命令', exact: true }).click();
  // The terminal view has its own tab strip; scope tab assertions to the visible one.
  const consoleTabs = () => page.locator('.workspace-view:not([hidden]) .session-tab');
  await openConsole();
  // Git badge: repository, current branch and a confirmed checkout that never touches the remote.
  if (gitReady) {
    const branchTrigger = () => page.getByRole('button', { name: /^切换分支/ });
    assert.equal((await page.locator('.git-repo').innerText()).trim(), 'project');
    assert.match(await branchTrigger().innerText(), /main/);
    for (const name of ['feature', 'main']) {
      await branchTrigger().click();
      await page.getByRole('option', { name, exact: true }).click();
      await page.locator('.confirmation-dialog[open]').getByRole('button', { name: '确认', exact: true }).click();
      await page.waitForFunction(async branch => (await window.studio.gitStatus((await window.studio.bootstrap()).projects[0].id)).branch === branch, name);
      assert.match(await branchTrigger().innerText(), new RegExp(name));
    }
    assert.equal(await readFile(path.join(project, 'sample.ts'), 'utf8'), 'export const sample = 1;\n');
  }
  await page.reload(); await page.locator('.session-row').first().waitFor();
  await page.locator('.session-row .session-open').first().click();
  assert.equal(await consoleTabs().count(), 2);
  await openConsole();
  const claude = state.providers.find(p => p.kind === 'claude-cli');
  await page.getByRole('button', { name: /^会话 CLI/ }).click();
  await page.getByRole('option', { name: claude.name, exact: true }).click();
  await page.getByRole('button', { name: /^会话模型/ }).click();
  await page.getByRole('option', { name: 'sonnet', exact: true }).click();
  await page.waitForFunction(async id => (await window.studio.bootstrap()).sessions.find(s => s.id === id)?.model === 'sonnet', ids.b);
  const selection = await page.evaluate(() => window.studio.bootstrap());
  assert.equal(selection.providers.find(p => p.id === claude.id).model, '');
  assert.equal(selection.sessions.find(s => s.id === ids.a).providerId, state.providers[0].id);
  await page.reload(); await page.locator('.session-row .session-open').first().click();
  await openConsole();
  assert.match(await page.getByRole('button', { name: /^会话模型/ }).innerText(), /sonnet/);

  await page.locator('.workspace-view:not([hidden]) .session-tab.active .tab-close').click();
  assert.equal(await consoleTabs().count(), 1);
  assert.equal((await page.evaluate(() => window.studio.bootstrap())).sessions.length, 2);
  await page.locator('.session-row .session-open').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.workspace-view:not([hidden]) .session-tab').length === 2);
  // Keep the icon inside the project focus outline.
  await page.getByRole('button', { name: /^当前项目/ }).focus();
  assert.ok(await page.locator('.project-select').evaluate(el => {
    const r = el.getBoundingClientRect(), icon = el.querySelector('svg').getBoundingClientRect();
    return getComputedStyle(el).outlineStyle === 'solid' && icon.left >= r.left && icon.right <= r.right;
  }));
  const nav = name => page.locator('.rail').getByRole('button', { name, exact: true });
  for (const theme of ['工业浅色主题', '午夜深蓝主题']) {
    await nav('设置').click(); await page.getByRole('button', { name: theme, exact: true }).click();
    await nav('终端命令').click(); await page.locator('.session-delete').first().click();
    const dialog = page.locator('.confirmation-dialog[open]'); await dialog.waitFor();
    assert.ok(await dialog.evaluate(el => {
      const style = getComputedStyle(el); const title = getComputedStyle(document.querySelector('.titlebar'));
      const light = document.documentElement.dataset.theme === 'industrial';
      return style.backgroundColor === (light ? 'rgb(247, 248, 244)' : 'rgb(21, 27, 39)') && title.backgroundColor === (light ? 'rgb(245, 246, 241)' : 'rgb(21, 27, 39)') && style.color === title.color;
    }));
    assert.equal(await page.getByRole('button', { name: '取消', exact: true }).evaluate(el => el === document.activeElement), true);
    const light = theme.startsWith('工业');
    const currentNotice = await noticeColors();
    assert.equal(new Set(currentNotice.map(entry => entry.split(':')[1])).size, 4);
    assert.match(currentNotice.find(entry => entry.startsWith('warning')), light ? /rgb\(253, 240, 221\)/ : /rgb\(43, 36, 23\)/);
    if (light) assert.notDeepEqual(currentNotice, midnightNotice, '通知配色随主题变化');
    await page.screenshot({ path: path.join(root, '.cache', theme.startsWith('工业') ? 'chrome-industrial.png' : 'chrome-midnight.png') });
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.equal((await page.evaluate(() => window.studio.bootstrap())).sessions.length, 2);
  }
  // Deletion from the full session page updates tabs/list and keeps project changes.
  await nav('会话').click(); await page.locator('.session-card-delete').first().click();
  await page.locator('.confirmation-dialog').getByRole('button', { name: '确认', exact: true }).click();
  await page.waitForFunction(async () => (await window.studio.bootstrap()).sessions.length === 1);
  await page.waitForFunction(() => document.querySelectorAll('.session-card').length === 1);
  let saved = await page.evaluate(() => window.studio.bootstrap());
  assert.ok(saved.changes.some(c => c.id === ids.change));
  assert.equal(await readFile(path.join(project, 'sample.ts'), 'utf8'), 'export const sample = 1;\n');
  await page.reload(); await page.locator('.session-row').first().waitFor();
  assert.equal(await page.locator('.session-row').count(), 1);
  // Cancellation prevents execution; renderer reload also cancels pending requests.
  const sessionId = saved.sessions[0].id;
  await page.evaluate(id => { window.commandResult = window.studio.command(id, 'Write-Output SHOULD_NOT_RUN'); }, sessionId);
  await page.locator('.confirmation-dialog[open]').waitFor(); await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.commandResult), null);
  await page.evaluate(id => { void window.studio.command(id, 'Write-Output SHOULD_NOT_RUN'); }, sessionId);
  await page.locator('.confirmation-dialog[open]').waitFor(); await page.reload();
  await page.locator('.window-controls').waitFor(); assert.equal(await page.locator('.confirmation-dialog').count(), 0);
  // Busy sessions are protected even through direct IPC.
  await page.evaluate(id => { window.commandResult = window.studio.command(id, 'Start-Sleep -Seconds 20'); }, sessionId);
  await page.locator('.confirmation-dialog').getByRole('button', { name: '确认', exact: true }).click();
  const runId = await page.evaluate(() => window.commandResult);
  const rejection = await page.evaluate(async id => { try { await window.studio.deleteSession(id); return ''; } catch (e) { return e.message; } }, sessionId);
  assert.match(rejection, /先停止/);
  await page.evaluate(id => window.studio.stop(id), runId);
  // Desktop window controls and retained preview button.
  await page.locator('.window-controls').getByRole('button', { name: '折叠预览', exact: true }).click();
  assert.equal(await page.locator('.preview-panel').isVisible(), false);
  await page.locator('.window-controls').getByRole('button', { name: '展开预览', exact: true }).click();
  await page.getByRole('button', { name: '最大化', exact: true }).click();
  await page.getByRole('button', { name: '还原窗口', exact: true }).waitFor();
  assert.ok(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()));
  await page.getByRole('button', { name: '还原窗口', exact: true }).click();
  await page.getByRole('button', { name: '最大化', exact: true }).waitFor();
  await page.getByRole('button', { name: '最小化', exact: true }).click();
  assert.ok(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.restore(); w.focus(); });
  assert.deepEqual(errors, []);
  const finished = app.waitForEvent('close'); await page.getByRole('button', { name: '关闭窗口', exact: true }).click(); await finished; closed = true;
  console.log('Desktop chrome passed: themed title/dialog, focus outline, tab close/reopen, delete/cancel/persistence, preserved changes, IPC busy guard, reload cancellation, maximize/restore/minimize/close.');
} finally { if (!closed) await app.close(); }

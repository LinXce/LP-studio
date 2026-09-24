import { _electron as electron } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Real cmdc -> ConPTY -> Electron renderer. Non-submitting text only: no AI request.
const root = process.cwd();
const runDir = path.join(root, '.cache', `command-terminal-${Date.now()}`);
const project = path.join(runDir, 'project');
await mkdir(project, { recursive: true });

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.LP_TERMINAL_TEST_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : {}), args: executablePath ? [] : [path.join(root, 'dist/main/main.cjs')], cwd: runDir, env });
app.process().stderr?.on('data', chunk => process.stderr.write(`[app] ${chunk}`));
try {
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', err => errors.push(err.message));
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, project);
  await page.getByRole('button', { name: '打开本地项目' }).click();
  const state = await page.evaluate(() => window.studio.bootstrap());
  const provider = state.providers.find(p => p.kind === 'command-cli');
  assert.ok(provider, 'missing Command CLI provider');
  await page.evaluate(provider => window.studio.saveProvider({ ...provider, executable: 'cmdc' }), provider);
  const session = await page.evaluate(({ projectId, providerId }) => window.studio.createSession(projectId, providerId), { projectId: state.projects[0].id, providerId: provider.id });
  await page.reload();
  const row = page.locator('.session-row').filter({ hasText: '新会话' }).first();
  await row.waitFor(); await row.locator('.session-open').click();
  await page.locator('.terminal-host .xterm-helper-textarea').waitFor({ timeout: 20000 });
  await page.evaluate(() => { window.seen = []; window.stopSeen = window.studio.onTerminal(e => window.seen.push(e.data)); });
  // Do not click the terminal or send an initial Enter. Nothing is submitted to the AI.
  assert.equal(await page.locator('.xterm-helper-textarea').evaluate(el => document.activeElement === el), true, 'first key has no terminal focus');
  await page.keyboard.type('EARLYTEXT');
  await page.waitForFunction(() => !document.querySelector('.terminal-boot'), undefined, { timeout: 15000 });
  await page.waitForFunction(() => window.seen.join('').includes('> EARLYTEXT'), undefined, { timeout: 10000 });
  const geometry = () => page.evaluate(() => {
    const area = document.querySelector('.xterm-helper-textarea');
    const screen = document.querySelector('.xterm-screen');
    const host = document.querySelector('.terminal-host');
    return { focused: document.activeElement === area, anchorX: area.getBoundingClientRect().x - screen.getBoundingClientRect().x, screenX: screen.getBoundingClientRect().x, width: screen.getBoundingClientRect().width, scrollLeft: host.scrollLeft };
  });
  const before = await geometry();
  assert.ok(before.focused && before.anchorX < before.width * .25, `cmdc candidate away from prompt: ${JSON.stringify(before)}`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'nihao'.repeat(40), selectionStart: 200, selectionEnd: 200 });
  const during = await geometry();
  assert.ok(during.focused && during.anchorX < during.width * .6 && during.screenX === before.screenX && during.scrollLeft === 0, `cmdc terminal moved during IME: ${JSON.stringify({ before, during })}`);
  await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
  assert.deepEqual(errors, []);
  console.log('Real cmdc smoke passed: first input without Enter, IME beside prompt, long composition leaves terminal in place.');
} finally { await app.close(); }
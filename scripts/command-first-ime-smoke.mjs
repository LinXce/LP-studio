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
  await page.locator('.terminal-boot').waitFor({state:'hidden',timeout:15000});
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5 });
  await cdp.send('Input.insertText', { text: '\u4f60\u597d' });
  await page.waitForFunction(() => window.seen.join('').includes('\u4f60\u597d'), undefined, { timeout: 10000 });
  console.log('PASS: first IME committed text reaches cmdc without Enter');
} finally { await app.close(); }

import { _electron as electron } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// End-to-end renderer -> Command CLI adapter -> ConPTY, with a deterministic Command-style prompt.
const root = process.cwd();
const runDir = path.join(root, '.cache', `command-terminal-${Date.now()}`);
const project = path.join(runDir, 'project');
await mkdir(project, { recursive: true });
const fixture = path.join(runDir, 'command-fixture.mjs');
await writeFile(fixture, `process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
let value = '';
const paint = () => process.stdout.write('\\x1b[2K\\r> Ask your question                    for shortcuts\x1b[70G');
paint(); setInterval(paint, 80);
process.stdin.on('data', chunk => {
  for (const char of chunk) {
    if (char === '\\r' || char === '\\n') { process.stdout.write('\\r\\nRECEIVED:' + value + '\\r\\n'); value = ''; }
    else { value += char; process.stdout.write('INPUT:' + char + '\\r\\n'); }
  }
});
`);
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
  await page.evaluate(({ provider, fixture }) => window.studio.saveProvider({ ...provider, executable: fixture }), { provider, fixture });
  const session = await page.evaluate(({ projectId, providerId }) => window.studio.createSession(projectId, providerId), { projectId: state.projects[0].id, providerId: provider.id });
  await page.reload();
  const row = page.locator('.session-row').filter({ hasText: '新会话' }).first();
  await row.waitFor(); await row.locator('.session-open').click();
  await page.locator('.terminal-host .xterm-helper-textarea').waitFor({ timeout: 20000 });
  await page.evaluate(() => { window.seen = []; window.stopSeen = window.studio.onTerminal(e => window.seen.push(e.data)); });
  await page.waitForFunction(() => !document.querySelector('.terminal-boot'), undefined, { timeout: 15000 });
  // A freshly selected session must accept the first key without clicking the terminal or pressing Enter.
  assert.equal(await page.locator('.terminal-host .xterm-helper-textarea').evaluate(el => document.activeElement === el), true, 'first input lacks terminal focus');
  await page.keyboard.type('hello');
  await page.waitForFunction(() => window.seen.join('').includes('INPUT:o'), undefined, { timeout: 6000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.seen.join('').includes('RECEIVED:hello'), undefined, { timeout: 6000 }).catch(async e => { console.log('INPUT DEBUG', await page.evaluate(() => ({seen: window.seen.filter(x => x.includes('INPUT') || x.includes('RECEIVED')).slice(-5), total: window.seen.length, boot: document.querySelector('.terminal-boot')?.textContent, notice: document.querySelector('.terminal-notice')?.textContent, focus: document.activeElement?.className, value: document.querySelector('.xterm-helper-textarea')?.value}))); throw e; });
  await page.evaluate(() => { window.seen = []; });
  const position = await page.evaluate(() => {
    const area = document.querySelector('.xterm-helper-textarea');
    const screen = document.querySelector('.xterm-screen');
    const buffer = document.querySelector('.terminal-host');
    const rect = area.getBoundingClientRect(), surface = screen.getBoundingClientRect();
    return { x: rect.x - surface.x, width: surface.width, focused: document.activeElement === area, buffer: buffer.innerText };
  });
  assert.ok(position.focused, `terminal not focused: ${JSON.stringify(position)}`);
  // CDP drives Chromium's real composition/input event sequence. Dispatching
  // synthetic DOM CompositionEvents misses xterm's native text mutations.
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => {
    window.commits = [];
    window.addEventListener('compositionend', event => window.commits.push(event.data), true);
  });
  const initialScreenX = await page.locator('.xterm-screen').evaluate(el => el.getBoundingClientRect().x);
  await cdp.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
  await cdp.send('Input.imeSetComposition', { text: 'nihao'.repeat(40), selectionStart: 200, selectionEnd: 200 });
  assert.equal(await page.locator('.xterm-screen').evaluate(el => el.getBoundingClientRect().x), initialScreenX, 'long composition scrolled terminal horizontally');
  assert.ok(await page.locator('.xterm-helper-textarea').evaluate(el => el.getBoundingClientRect().x - document.querySelector('.xterm-screen').getBoundingClientRect().x) < position.width * 0.6, 'long composition moves IME to right edge');
  await cdp.send('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5 });
  assert.equal(await page.locator('.terminal-ime-preview').count(), 0, 'second IME preview appeared');
  assert.equal(await page.locator('.composition-view').evaluate(el => getComputedStyle(el).opacity), '0', 'duplicate preedit is visible');
  await cdp.send('Input.insertText', { text: '\u4f60\u597d' });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.seen.join('').includes('RECEIVED:\u4f60\u597d'), undefined, { timeout: 6000 });
  const seen = await page.evaluate(() => window.seen.join(''));
  assert.deepEqual(await page.evaluate(() => window.commits), ['\u4f60\u597d']);
  assert.equal((seen.match(/INPUT:\u4f60/g) ?? []).length, 1, `first character was sent twice: ${JSON.stringify(seen)}`);
  assert.equal((seen.match(/INPUT:\u597d/g) ?? []).length, 1, `second character was sent twice: ${JSON.stringify(seen)}`);
  assert.ok(!seen.includes('nihao') && !seen.includes('\u4f60\u597d\u4f60\u597d'), 'pinyin or repeated commit reached CLI');
  assert.ok(position.x < position.width * 0.6, `candidate anchor at terminal edge: ${JSON.stringify(position)}`);
  // A single Enter while the IME is still composing must finalize the text
  // and submit it to the CLI; intercepting xterm's keydown breaks this path.
  await page.evaluate(() => { window.seen = []; });
  await cdp.send('Input.imeSetComposition', { text: '\u4e2d\u6587', selectionStart: 2, selectionEnd: 2 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.seen.join('').includes('RECEIVED:\u4e2d\u6587'), undefined, { timeout: 6000 });
  const oneEnter = await page.evaluate(() => window.seen.join(''));
  assert.equal((oneEnter.match(/RECEIVED:\u4e2d\u6587/g) ?? []).length, 1, `IME Enter submitted twice: ${JSON.stringify(oneEnter)}`);
  await page.evaluate(() => { window.seen = []; });
  await cdp.send('Input.imeSetComposition', { text: 'cancel', selectionStart: 6, selectionEnd: 6 });
  await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
  await page.keyboard.type('after'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.seen.join('').includes('RECEIVED:after'), undefined, { timeout: 6000 });
  assert.deepEqual(errors, []);
  console.log('Command terminal smoke passed: continuous prompt, English input, native Chinese composition once, one Enter while composing submits, no double preview, candidate position, cancelled IME and subsequent input.');
} finally { await app.close(); }

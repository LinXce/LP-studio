import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import { checkPanelToggles } from './panel-checks.mjs';
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: path.resolve('release/win-unpacked/LP Studio.exe'), args: [], env });
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: '从想法，到下一次提交。' }).waitFor();
  const state = await page.evaluate(() => window.studio.bootstrap());
  assert.equal(state.version, '0.1.0');
  assert.ok(state.providers.some(p => p.kind === 'command-cli'));
  await checkPanelToggles(page);
  assert.ok(state.dataDir.endsWith(path.join('win-unpacked', '.lp-data')));
  assert.ok(page.url().startsWith('file:///'));
  assert.ok(await app.evaluate(({ app }) => app.isPackaged));
  const originalTheme = await page.evaluate(() => localStorage.getItem('lp-theme'));
  const nav = name => page.locator('.rail').getByRole('button', { name, exact: true });
  try {
    await nav('模型与 API Key').click();
    await page.getByRole('heading', { name: '模型与连接' }).waitFor();
    assert.equal(await page.locator('.terminal-panel').isVisible(), false);
    assert.equal(await page.locator('.modal-backdrop').count(), 0);
    await nav('设置').click();
    await page.getByRole('button', { name: '工业浅色主题', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'industrial');
    await page.reload(); await nav('设置').click();
    assert.equal(await page.getByRole('button', { name: '工业浅色主题', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.screenshot({ animations: 'disabled', path: path.resolve('.cache/packaged-theme-settings.png') });
    await nav('工作台').click();
    await page.screenshot({ animations: 'disabled', path: path.resolve('.cache/packaged-theme-industrial.png') });
  } finally {
    await page.evaluate(theme => { if (theme === null) localStorage.removeItem('lp-theme'); else localStorage.setItem('lp-theme', theme); }, originalTheme);
  }
  console.log('Packaged EXE passed: local resources, desktop IPC, portable data, embedded navigation and persisted themes.');
} finally { await app.close(); }

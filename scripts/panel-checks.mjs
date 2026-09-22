import assert from 'node:assert/strict';

// Test rendered geometry, not just display:none: a zero-width grid track was "visible".
export async function assertPanelLayout(page, { left = true, right = true } = {}) {
  const geometry = await page.evaluate(() => {
    const rect = selector => {
      const el = document.querySelector(selector); const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, width: r.width, height: r.height, hidden: el.hidden };
    };
    return { rail: rect('.rail'), project: rect('.project-panel'), main: rect('.central-workspace'), preview: rect('.preview-panel'), content: rect('#preview-content'), workspace: rect('.workspace') };
  });
  assert.ok(geometry.main.width >= 329, JSON.stringify(geometry));
  assert.ok(geometry.main.height > 300, JSON.stringify(geometry));
  assert.ok(Math.abs(geometry.main.y - geometry.workspace.y) < 1);
  assert.ok(Math.abs(geometry.main.height - geometry.workspace.height) < 1);
  assert.ok(geometry.main.x >= geometry.rail.right - 1);
  assert.ok(geometry.main.right <= (right ? geometry.preview.x : geometry.workspace.right) + 1);
  assert.equal(geometry.project.hidden, !left);
  if (left) assert.ok(geometry.project.width >= 190);
  assert.equal(geometry.content.hidden, !right);
  assert.ok(right ? geometry.preview.width >= 280 : geometry.preview.width === 0);
  const toggle = page.locator('.window-controls').getByRole('button', { name: right ? '折叠预览' : '展开预览', exact: true });
  assert.ok(await toggle.isVisible());
  assert.equal(await toggle.getAttribute('aria-expanded'), String(right));
}
export async function checkPanelToggles(page) {
  const rail = page.locator('.rail');
  await assertPanelLayout(page);
  await rail.getByRole('button', { name: '切换项目栏', exact: true }).click();
  await assertPanelLayout(page, { left: false });
  await page.locator('.window-controls').getByRole('button', { name: '折叠预览', exact: true }).click();
  await assertPanelLayout(page, { left: false, right: false });
  await rail.getByRole('button', { name: '设置', exact: true }).click();
  await assertPanelLayout(page, { left: false, right: false });
  await page.getByRole('heading', { name: '工作台设置' }).waitFor();
  await page.locator('.window-controls').getByRole('button', { name: '展开预览', exact: true }).click();
  await assertPanelLayout(page, { left: false });
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+j');
  await assertPanelLayout(page, { right: false });
  await page.keyboard.press('Control+j');
  await assertPanelLayout(page);
  await rail.getByRole('button', { name: '工作台', exact: true }).click();
}

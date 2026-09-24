import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gitCheckout, gitStatus } from '../packages/core/git';

// Keep these repos outside the workspace so the parent repository never leaks into the result.
function git(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => execFile('git', args, { cwd, windowsHide: true }, (error, _stdout, stderr) => error ? reject(Error(String(stderr).trim() || error.message)) : resolve()));
}
const available = new Promise<boolean>(resolve => execFile('git', ['--version'], { windowsHide: true }, error => resolve(!error)));
async function repository(t: any) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lp-git-'));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });
  await git(dir, ['init', '-b', 'main']);
  await git(dir, ['-c', 'user.name=LP Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'init']);
  await git(dir, ['branch', 'feature']);
  return dir;
}
test('git status reports nothing outside a repository', async t => {
  if (!await available) return t.skip('未安装 git');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lp-plain-'));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });
  assert.deepEqual(await gitStatus(dir), { repository: null, branch: null, branches: [] });
});
test('git status lists the repository and its local branches', async t => {
  if (!await available) return t.skip('未安装 git');
  const dir = await repository(t); const status = await gitStatus(dir);
  assert.equal(status.repository, path.basename(dir));
  assert.equal(status.branch, 'main');
  assert.deepEqual([...status.branches].sort(), ['feature', 'main']);
});
test('git checkout switches branches and rejects unlisted or unsafe names', async t => {
  if (!await available) return t.skip('未安装 git');
  const dir = await repository(t);
  await gitCheckout(dir, 'feature');
  assert.equal((await gitStatus(dir)).branch, 'feature');
  assert.equal((await gitStatus(dir)).repository, path.basename(dir));
  await gitCheckout(dir, 'main');
  assert.equal((await gitStatus(dir)).branch, 'main');
  await assert.rejects(gitCheckout(dir, 'missing'), /本地已有分支/);
  await assert.rejects(gitCheckout(dir, '--upload-pack=evil'), /分支名无效/);
});

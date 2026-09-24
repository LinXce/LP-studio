import { execFile } from 'node:child_process';
import path from 'node:path';
import type { GitStatus } from '../contracts';

const empty: GitStatus = { repository: null, branch: null, branches: [] };

// Read-only inspection plus an explicit checkout; never routed through a shell.
function run(root: string, args: string[], timeout = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['--no-pager', ...args], {
      cwd: root, timeout, maxBuffer: 1024 * 1024, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    }, (error, stdout, stderr) => {
      if (error) { const detail = String(stderr ?? '').trim().split(/\r?\n/).filter(Boolean).slice(-3).join('\n'); reject(Error(detail || error.message)); }
      else resolve(stdout);
    });
  });
}
export async function gitStatus(root: string): Promise<GitStatus> {
  let top: string;
  try { top = (await run(root, ['rev-parse', '--show-toplevel'])).trim(); } catch { return empty; }
  if (!top) return empty;
  let branch: string | null = null;
  try { branch = (await run(root, ['branch', '--show-current'])).trim() || null; } catch { /* detached or unreadable HEAD */ }
  let branches: string[] = [];
  try { branches = (await run(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).split(/\r?\n/).map(name => name.trim()).filter(Boolean).slice(0, 200); } catch { /* keep whatever was read */ }
  if (branch && !branches.includes(branch)) branches = [branch, ...branches];
  return { repository: path.basename(top) || null, branch, branches };
}
export async function gitCheckout(root: string, branch: string): Promise<void> {
  const name = branch.trim();
  if (!name || name.length > 200 || name.startsWith('-') || name.includes('\0')) throw Error('分支名无效');
  const status = await gitStatus(root);
  if (!status.repository) throw Error('当前项目不是 Git 仓库');
  if (name === status.branch) return;
  if (!status.branches.includes(name)) throw Error('只能切换到本地已有分支，请先在外部创建或拉取');
  await run(root, ['checkout', name], 60000);
}

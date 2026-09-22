import { createHash, randomUUID } from 'node:crypto';
import { lstat, realpath, readdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Change, FileSnapshot } from '../contracts';
import type { Store } from './storage';
export const MAX_FILE_BYTES = 1024 * 1024;
const hidden = new Set(['.git', 'node_modules', '.lp-data', '.cache', 'dist', 'release', '.ssh', '.aws', '.codex', '.claude', '.gemini']);
export function denied(name: string) { return hidden.has(name.toLowerCase()) || /^\.env(?:\.|$)/i.test(name) || /\.(pem|key|pfx|p12)$/i.test(name); }
export function hash(content: string) { return createHash('sha256').update(content).digest('hex'); }
export function inside(root: string, target: string) {
  const relative = path.relative(root, target);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}
export async function resolveSafe(root: string, relative: string, directory = false) {
  if (relative.includes('\0') || relative.includes(':') || path.isAbsolute(relative)) throw Error('只能访问项目内的相对路径');
  const parts = relative.split(/[\\/]/).filter(Boolean);
  if (parts.some(p => p === '..' || (p !== '.' && /[. ]$/.test(p)) || denied(p))) throw Error('路径越界或包含受保护文件');
  const canonicalRoot = await realpath(root);
  let target = canonicalRoot;
  for (const part of parts) {
    target = path.join(target, part);
    if ((await lstat(target)).isSymbolicLink()) throw Error('MVP 不跟随符号链接或 junction');
  }
  target = await realpath(target);
  if (!inside(canonicalRoot, target)) throw Error('路径越界');
  const stat = await lstat(target);
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw Error(directory ? '不是目录' : '不是普通文件');
  return target;
}
export async function listFiles(root: string, relative: string) {
  const full = await resolveSafe(root, relative, true);
  const entries = await readdir(full, { withFileTypes: true });
  return entries.filter(e => !denied(e.name) && !e.isSymbolicLink() && (e.isDirectory() || e.isFile()))
    .sort((a,b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .slice(0, 1000).map(e => ({ name: e.name, path: [...relative.split(/[\\/]/).filter(Boolean), e.name].join('/'), directory: e.isDirectory() }));
}
export async function readSnapshot(root: string, relative: string): Promise<FileSnapshot> {
  const full = await resolveSafe(root, relative);
  if ((await lstat(full)).size > MAX_FILE_BYTES) throw Error('文件超过 1 MB，请使用外部编辑器');
  const bytes = await readFile(full);
  if (bytes.length > MAX_FILE_BYTES || bytes.includes(0)) throw Error('不支持二进制或超大文件');
  let content: string;
  try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw Error('仅支持 UTF-8 文本，未更改原始文件'); }
  return { path: relative, content, hash: hash(content) };
}
export class FileService {
  private busy = false;
  constructor(private store: Store) {}
  async propose(projectId: string, snapshot: FileSnapshot, after: string, sessionId?: string): Promise<Change> {
    if (Buffer.byteLength(after) > MAX_FILE_BYTES || after.includes('\0')) throw Error('修改内容过大或不是文本');
    const current = await readSnapshot(this.store.project(projectId).root, snapshot.path);
    if (current.hash !== snapshot.hash || hash(snapshot.content) !== snapshot.hash) throw Error('文件已在外部变更，请重新打开后修改');
    if (current.content === after) throw Error('文件内容没有变化');
    const change: Change = { id: randomUUID(), projectId, sessionId, path: snapshot.path, before: snapshot.content, after, baseHash: snapshot.hash, state: 'pending', time: new Date().toISOString() };
    this.store.state.changes.push(change); this.store.save(); return change;
  }
  async update(id: string, rollback: boolean): Promise<Change> {
    if (this.busy) throw Error('另一个文件操作正在进行'); this.busy = true;
    try {
      const change = this.store.state.changes.find(c => c.id === id);
      if (!change) throw Error('修改记录不存在');
      if (change.state !== (rollback ? 'applied' : 'pending')) throw Error('修改状态已改变，请刷新');
      const root = this.store.project(change.projectId).root;
      const current = await readSnapshot(root, change.path);
      const expected = rollback ? hash(change.after) : change.baseHash;
      if (current.hash !== expected) throw Error('检测到外部修改，已拒绝覆盖。请重新读取并合并。');
      const full = await resolveSafe(root, change.path);
      const temp = `${full}.lp-${randomUUID()}.tmp`;
      const previous = change.state;
      change.state = rollback ? 'rolling-back' : 'applying'; this.store.save();
      try {
        await writeFile(temp, rollback ? change.before : change.after, { encoding: 'utf8', flag: 'wx', mode: (await lstat(full)).mode });
        if ((await readSnapshot(root, change.path)).hash !== expected) throw Error('写入前文件发生变化');
        await rename(temp, full);
      } catch (err) {
        await unlink(temp).catch(() => {}); change.state = previous; this.store.save(); throw err;
      }
      change.state = rollback ? 'rolled-back' : 'applied'; this.store.save(); return change;
    } finally { this.busy = false; }
  }
  async recover() {
    for (const c of this.store.state.changes) {
      if (c.state !== 'applying' && c.state !== 'rolling-back') continue;
      try {
        const current = await readSnapshot(this.store.project(c.projectId).root, c.path);
        if (current.hash === hash(c.after)) c.state = 'applied';
        else if (current.hash === c.baseHash) c.state = c.state === 'applying' ? 'pending' : 'rolled-back';
        // Ambiguous external edits stay blocked for manual recovery from the saved before/after.
      } catch { /* A migrated project may not yet be accessible. */ }
    }
    this.store.save();
  }
}

import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
export interface Launch { executable: string; args: string[] }
// Build a cmd.exe command line for launching a CLI in a real console window.
// `%` and `!` are still expanded inside quotes, so those are refused; quoting covers & | < > ^.
export function consoleLine(parts: string[]): string {
  const args = parts.filter(Boolean);
  if (/[\r\n%!]/.test(args.join(' '))) throw Error('启动参数包含 cmd 特殊字符，无法在系统终端中打开');
  const line = args.map(part => /^[\w@./\\:+-]+$/.test(part) ? part : `"${part.replace(/"/g, '')}"`).join(' ');
  if (/[\r\n&|<>^]/.test(line.replace(/"[^"]*"/g, ''))) throw Error('启动参数包含 cmd 特殊字符，无法在系统终端中打开');
  return line;
}
// Electron's own binary exits silently when spawned as a PTY child, so interactive runs need a real Node.
export async function resolveNodeRuntime(): Promise<string> {
  const names = process.platform === 'win32' ? ['node.exe'] : ['node'];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const file = path.resolve(dir, name);
      try { await access(file); return file; } catch { continue; }
    }
  }
  throw Error('未在 PATH 中找到 node，无法在终端里启动该 CLI。请安装 Node.js 或改用原生可执行文件的 CLI。');
}
// Resolve npm .cmd wrappers to their JS entry point, never interpolate a prompt into cmd.exe.
export async function resolveExecutable(command: string): Promise<Launch> {
  const names = process.platform === 'win32' && !path.extname(command) ? [command + '.exe', command + '.cmd', command] : [command];
  const dirs = path.isAbsolute(command) ? [''] : (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) for (const name of names) {
    const file = path.resolve(dir, name);
    try { await access(file); } catch { continue; }
    if (/\.cmd$/i.test(file)) {
      const script = await readFile(file, 'utf8');
      const match = script.match(/"%[~]?dp0%?[\\/]([^"\r\n]+\.(?:js|cjs|mjs))"/i)
        ?? script.match(/"%~dp0[\\/]([^"\r\n]+\.(?:js|cjs|mjs))"/i);
      if (!match) throw Error('无法安全解析此 .cmd。请配置 CLI .exe 或 .js 入口的完整路径。');
      const entry = path.resolve(path.dirname(file), match[1]); await access(entry);
      return { executable: process.execPath, args: [entry] };
    }
    if (/\.(?:mjs|cjs|js)$/i.test(file)) return { executable: process.execPath, args: [file] };
    if (/\.(?:bat|ps1)$/i.test(file)) throw Error('请使用原生可执行文件或 npm CLI 入口');
    return { executable: file, args: [] };
  }
  throw Error(`未找到 ${command}，请安装 CLI 或在模型设置中填写完整路径`);
}
export async function killTree(pid: number) {
  if (process.platform === 'win32') {
    await new Promise<void>(resolve => {
      const child = spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      child.once('exit', () => resolve()); child.once('error', () => resolve());
    });
  } else { try { process.kill(-pid, 'SIGKILL'); } catch { /* already exited */ } }
}
// Turn the tail of stderr into a short suffix so the failure notice carries the CLI's own reason.
function reason(tail: string) {
  const lines = tail.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(-4);
  return lines.length ? `：${lines.join('\n')}` : '，请查看错误输出';
}
export function runProcess(launch: Launch, args: string[], options: { cwd: string; signal: AbortSignal; input?: string; stdout: (text: string) => void; stderr: (text: string) => void; env?: NodeJS.ProcessEnv }): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) return reject(options.signal.reason ?? Error('已停止'));
    const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...options.env };
    delete env.NODE_OPTIONS;
    const child = spawn(launch.executable, [...launch.args, ...args], { cwd: options.cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: 'pipe' });
    let size = 0; let failure: Error | undefined; let killPromise: Promise<void> | undefined; let tail = '';
    const abort = () => { failure ??= Error(String(options.signal.reason?.message ?? '运行已停止')); if (child.pid) killPromise ??= killTree(child.pid); };
    options.signal.addEventListener('abort', abort, { once: true });
    const consume = (text: string, cb: (text: string) => void) => {
      if (failure) return;
      size += Buffer.byteLength(text);
      try { if (size > 8 * 1024 * 1024) throw Error('输出超过 8 MB，已停止进程'); cb(text); }
      catch (err) { failure = err as Error; abort(); }
    };
    child.stdout.setEncoding('utf8').on('data', text => consume(text, options.stdout));
    // Keep the last stderr lines so a non-zero exit can explain itself in the notice.
    child.stderr.setEncoding('utf8').on('data', text => consume(text, chunk => { tail = (tail + chunk).slice(-800); options.stderr(chunk); }));
    child.stdin.on('error', () => {});
    child.once('error', err => { failure = err; });
    child.once('close', async code => {
      options.signal.removeEventListener('abort', abort); await killPromise;
      if (failure) reject(failure); else if (code !== 0) reject(Error(`进程退出码 ${code}${reason(tail)}`)); else resolve();
    });
    child.stdin.end(options.input ?? '');
  });
}

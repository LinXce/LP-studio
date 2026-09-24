import type { TerminalEvent, TerminalStart } from '../../packages/contracts';
import { sessionConfig } from '../../packages/core/sessions';
import type { Store } from '../../packages/core/storage';
import { adapterFor } from '../../packages/providers';
import { resolveExecutable, resolveNodeRuntime } from '../../packages/providers/process';

interface PtyProcess {
  onData(callback: (data: string) => void): void;
  onExit(callback: (event: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}
export interface PtyModule {
  spawn(file: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; cols: number; rows: number; name: string }): PtyProcess;
}
// node-pty is an optional dependency: without it the terminal reports why instead of breaking the app.
// Tests pass a fake module, or null to simulate a machine where the native build is missing.
function loadPty(injected?: PtyModule | null): PtyModule | null {
  if (injected !== undefined) return injected;
  try { return require('node-pty') as PtyModule; } catch { return null; }
}
const MAX_SESSION_BYTES = 64 * 1024 * 1024;
export class TerminalService {
  private sessions = new Map<string, PtyProcess>();
  constructor(private store: Store, private emit: (event: TerminalEvent) => void, private injected?: PtyModule | null) {}
  has(sessionId: string) { return this.sessions.has(sessionId); }
  async start(sessionId: string): Promise<TerminalStart> {
    if (this.sessions.has(sessionId)) return { ok: true, message: '终端已在运行' };
    const session = this.store.session(sessionId);
    const project = this.store.project(session.projectId);
    const config = sessionConfig(this.store, session.id);
    const adapter = adapterFor(config.kind);
    if (!adapter.interactive) return { ok: false, message: '该连接不是本机 CLI，没有可交互的终端。请在“模型与 API Key”里改用 CLI 连接。' };
    const pty = loadPty(this.injected);
    if (!pty) return { ok: false, message: '未安装 PTY 组件（node-pty），终端暂不可用。请重新运行安装依赖脚本后重启应用。' };
    const preset = adapter.interactive(config);
    const launch = await resolveExecutable(preset.command);
    // A .cmd/npm wrapper resolves to the Electron binary, which cannot host a PTY: use the real Node instead.
    const executable = launch.executable === process.execPath ? await resolveNodeRuntime() : launch.executable;
    const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    delete env.NODE_OPTIONS;
    const child = pty.spawn(executable, [...launch.args, ...preset.args], { cwd: project.root, env, cols: 120, rows: 30, name: 'xterm-256color' });
    console.log(`[term] spawn ${executable} ${[...launch.args, ...preset.args].join(' ')} cwd=${project.root}`);
    this.sessions.set(sessionId, child);
    let bytes = 0; let capped = false;
    child.onData(data => {
      if (capped) return;
      bytes += Buffer.byteLength(data);
      if (bytes > MAX_SESSION_BYTES) {
        capped = true;
        this.emit({ sessionId, type: 'data', data: '\r\n[LP Studio] 终端输出超过上限，已终止该终端。\r\n' });
        this.stop(sessionId);
        return;
      }
      this.emit({ sessionId, type: 'data', data });
    });
    child.onExit(({ exitCode }) => { this.sessions.delete(sessionId); this.emit({ sessionId, type: 'exit', data: '', exitCode }); });
    return { ok: true, message: '' };
  }
  write(sessionId: string, data: string) { this.sessions.get(sessionId)?.write(data); }
  resize(sessionId: string, cols: number, rows: number) { this.sessions.get(sessionId)?.resize(cols, rows); }
  stop(sessionId: string) {
    const child = this.sessions.get(sessionId);
    if (!child) return;
    this.sessions.delete(sessionId);
    try { child.kill(); } catch { /* already gone */ }
  }
  stopAll() { for (const id of [...this.sessions.keys()]) this.stop(id); }
}

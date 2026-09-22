import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Change, Project, ProviderConfig, Session } from '../contracts';
export interface StoredState { schemaVersion: 1; migrations?: string[]; projects: Project[]; providers: ProviderConfig[]; sessions: Session[]; changes: Change[] }
export function atomicJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, file);
}
export class Store {
  readonly file: string;
  state: StoredState;
  constructor(readonly dir: string) {
    this.file = path.join(dir, 'workspace.json');
    this.state = { schemaVersion: 1, projects: [], providers: [], sessions: [], changes: [] };
    if (existsSync(this.file)) {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      if (parsed.schemaVersion !== 1 || !['projects', 'providers', 'sessions', 'changes'].every(k => Array.isArray(parsed[k]))) throw Error('本地数据格式不兼容，请备份 workspace.json 后检查版本。');
      if (parsed.migrations !== undefined && (!Array.isArray(parsed.migrations) || !parsed.migrations.every((v: unknown) => typeof v === 'string'))) throw Error('本地迁移记录格式不兼容');
      this.state = parsed;
    }
  }
  save() { atomicJson(this.file, this.state); }
  project(id: string) { const p = this.state.projects.find(p => p.id === id); if (!p) throw Error('项目不存在'); return p; }
  session(id: string) { const s = this.state.sessions.find(s => s.id === id); if (!s) throw Error('会话不存在'); return s; }
  provider(id: string) { const p = this.state.providers.find(p => p.id === id); if (!p) throw Error('请先配置模型'); return p; }
}

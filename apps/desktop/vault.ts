import { safeStorage } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { atomicJson } from '../../packages/core/storage';
export class Vault {
  private entries: Record<string, string> = {};
  private file: string;
  constructor(dir: string) {
    this.file = path.join(dir, 'secrets.json');
    if (existsSync(this.file)) this.entries = JSON.parse(readFileSync(this.file, 'utf8'));
  }
  has(id: string) { return Boolean(this.entries[id]); }
  set(id: string, key: string) {
    if (!key) delete this.entries[id];
    else {
      if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) throw Error('操作系统安全存储不可用，拒绝明文保存密钥');
      this.entries[id] = safeStorage.encryptString(key).toString('base64');
    }
    atomicJson(this.file, this.entries);
  }
  async get(id: string) {
    if (!this.entries[id]) return undefined;
    try { return safeStorage.decryptString(Buffer.from(this.entries[id], 'base64')); }
    catch { throw Error('此密钥无法在当前 Windows 用户或电脑上解密，请重新填写 API Key'); }
  }
}

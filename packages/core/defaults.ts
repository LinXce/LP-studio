import { randomUUID } from 'node:crypto';
import type { ProviderConfig } from '../contracts';
import type { Store } from './storage';

const commandMigration = 'command-cli-default-v1';
const antigravityMigration = 'antigravity-cli-default-v1';
function provider(kind: ProviderConfig['kind'], name: string): ProviderConfig {
  return { id: randomUUID(), name, kind, model: '', executable: '', baseUrl: '', timeoutMs: 300000 };
}
// Add the new built-in once to existing workspaces without replacing user settings.
export function ensureDefaultProviders(store: Store) {
  let changed = false;
  if (!store.state.providers.length) {
    store.state.providers = [provider('codex-cli', 'codex CLI'), provider('claude-cli', 'claude CLI'), provider('gemini-cli', 'gemini CLI')];
    changed = true;
  }
  if (!store.state.migrations?.includes(commandMigration)) {
    if (!store.state.providers.some(p => p.kind === 'command-cli')) store.state.providers.push(provider('command-cli', 'Command CLI (cmdc)'));
    store.state.migrations = [...(store.state.migrations ?? []), commandMigration];
    changed = true;
  }
  if (!store.state.migrations?.includes(antigravityMigration)) {
    if (!store.state.providers.some(p => p.kind === 'antigravity-cli')) store.state.providers.push(provider('antigravity-cli', 'Antigravity CLI (agy)'));
    store.state.migrations = [...(store.state.migrations ?? []), antigravityMigration];
    changed = true;
  }
  if (changed) store.save();
}

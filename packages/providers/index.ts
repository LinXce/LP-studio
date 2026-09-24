import type { ProviderConfig } from '../contracts';
import type { ProviderAdapter } from './types';
import { CliAdapter } from './cli';
import { CommandCliAdapter } from './command';
import { AntigravityCliAdapter } from './antigravity';
import { ApiAdapter } from './api';
const cli = new CliAdapter(); const api = new ApiAdapter();
const registry: Record<ProviderConfig['kind'], ProviderAdapter> = {
  'codex-cli': cli, 'claude-cli': cli, 'gemini-cli': cli, 'command-cli': new CommandCliAdapter(), 'antigravity-cli': new AntigravityCliAdapter(),
  'openai-api': api, 'anthropic-api': api, 'gemini-api': api,
};
// The command a CLI provider falls back to, shared by the confirmations and the adapters.
const defaults: Partial<Record<ProviderConfig['kind'], string>> = { 'codex-cli': 'codex', 'claude-cli': 'claude', 'gemini-cli': 'gemini', 'command-cli': 'cmdc', 'antigravity-cli': 'agy' };
export function defaultExecutable(kind: ProviderConfig['kind']) { return defaults[kind] ?? ''; }
export function adapterFor(kind: ProviderConfig['kind']) { const adapter = registry[kind]; if (!adapter) throw Error('未知适配器'); return adapter; }
export type { ProviderAdapter, ProviderInput, ProviderEvent } from './types';

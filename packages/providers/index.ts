import type { ProviderConfig } from '../contracts';
import type { ProviderAdapter } from './types';
import { CliAdapter } from './cli';
import { CommandCliAdapter } from './command';
import { ApiAdapter } from './api';
const cli = new CliAdapter(); const api = new ApiAdapter();
const registry: Record<ProviderConfig['kind'], ProviderAdapter> = {
  'codex-cli': cli, 'claude-cli': cli, 'gemini-cli': cli, 'command-cli': new CommandCliAdapter(),
  'openai-api': api, 'anthropic-api': api, 'gemini-api': api,
};
export function adapterFor(kind: ProviderConfig['kind']) { const adapter = registry[kind]; if (!adapter) throw Error('未知适配器'); return adapter; }
export type { ProviderAdapter, ProviderInput, ProviderEvent } from './types';

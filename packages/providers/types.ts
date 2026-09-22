import type { ProviderConfig } from '../contracts';
export interface ProviderInput { config: ProviderConfig; cwd: string; prompt: string; signal: AbortSignal; key?: string }
export type ProviderEvent = { type: 'text' | 'status'; text: string };
export interface ProviderAdapter {
  run(input: ProviderInput, emit: (event: ProviderEvent) => void): Promise<void>;
  listModels?(config: ProviderConfig): Promise<string[]>;
  probe(config: ProviderConfig): Promise<string>;
}

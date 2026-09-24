import type { Grant, ProviderConfig } from '../contracts';
export interface ProviderInput { config: ProviderConfig; cwd: string; prompt: string; signal: AbortSignal; key?: string; grants?: Grant[] }
export type ProviderEvent =
  | { type: 'text'; text: string }
  | { type: 'status'; text: string }
  // A tool the CLI queued or refused; headless runs cannot ask, so the app turns denials into an in-stream request.
  | { type: 'tool'; state: 'queued' | 'denied'; name: string; detail: string };
export interface ProviderAdapter {
  run(input: ProviderInput, emit: (event: ProviderEvent) => void): Promise<void>;
  listModels?(config: ProviderConfig): Promise<string[]>;
  probe(config: ProviderConfig): Promise<string>;
  // Set when the adapter turns a session grant into real CLI arguments; others keep denials as plain status.
  supportsGrants?: boolean;
  // Interactive launch for the embedded terminal: no -p, no output format — the CLI's own TUI.
  interactive?(config: ProviderConfig): { command: string; args: string[] };
}

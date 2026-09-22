import { z } from 'zod';
export const providerKinds = ['codex-cli', 'claude-cli', 'gemini-cli', 'command-cli', 'openai-api', 'anthropic-api', 'gemini-api'] as const;
export const providerSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(80), kind: z.enum(providerKinds),
  model: z.string().max(150).default(''), models: z.array(z.string().trim().min(1).max(150)).max(200).optional(), executable: z.string().max(1000).default(''),
  baseUrl: z.string().max(2000).default(''), timeoutMs: z.number().int().min(10000).max(1800000).default(300000),
});
export type ProviderConfig = z.infer<typeof providerSchema>;
export type ProviderView = ProviderConfig & { hasKey: boolean };
export interface Project { id: string; name: string; root: string }
export interface Message { id: string; role: 'user' | 'assistant' | 'system'; text: string; time: string }
export interface Session { id: string; projectId: string; providerId: string; model?: string; startedAt?: string; title: string; messages: Message[]; updatedAt: string }
export interface FileEntry { name: string; path: string; directory: boolean }
export interface FileSnapshot { path: string; content: string; hash: string }
export interface Change { id: string; projectId: string; sessionId?: string; path: string; before: string; after: string; baseHash: string; state: 'pending' | 'applying' | 'applied' | 'rolling-back' | 'rolled-back'; time: string }
export interface Bootstrap { projects: Project[]; sessions: Session[]; providers: ProviderView[]; changes: Change[]; dataDir: string; version: string }
export interface RunRequest { sessionId: string; prompt: string; context: string[] }
export type StreamEvent = { runId: string; sessionId: string; type: 'text' | 'status' | 'error' | 'done'; text: string };
export interface Confirmation { id: string; title: string; detail: string }
export interface StudioBridge {
  windowControl(action: 'minimize' | 'maximize' | 'close'): Promise<void>;
  windowMaximized(): Promise<boolean>;
  onWindowState(callback: (maximized: boolean) => void): () => void;
  onConfirm(callback: (request: Confirmation) => void): () => void;
  answerConfirm(id: string, accepted: boolean): Promise<void>;
  deleteSession(id: string): Promise<boolean>;
  bootstrap(): Promise<Bootstrap>;
  openProject(): Promise<Project | null>;
  relocateProject(projectId: string): Promise<Project | null>;
  tree(projectId: string, path: string): Promise<FileEntry[]>;
  readFile(projectId: string, path: string): Promise<FileSnapshot>;
  createSession(projectId: string, providerId: string, model?: string): Promise<Session>;
  configureSession(id: string, providerId: string, model: string): Promise<Session>;
  providerModels(id: string, discover?: boolean): Promise<{ models: string[]; note: string }>;
  saveProvider(config: ProviderConfig, key?: string): Promise<ProviderView>;
  deleteProvider(id: string): Promise<void>;
  probeProvider(id: string): Promise<string>;
  run(request: RunRequest): Promise<string>;
  stop(runId: string): Promise<void>;
  command(sessionId: string, command: string): Promise<string | null>;
  propose(projectId: string, snapshot: FileSnapshot, content: string): Promise<Change>;
  apply(changeId: string): Promise<Change | null>;
  rollback(changeId: string): Promise<Change | null>;
  onEvent(callback: (event: StreamEvent) => void): () => void;
}

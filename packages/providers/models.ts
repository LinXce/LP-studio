import type { ProviderConfig } from '../contracts';
// Stable aliases, not an account entitlement list. Exact IDs stay user-configurable.
export function configuredModels(config: ProviderConfig): string[] {
  const aliases = config.kind === 'claude-cli' ? ['sonnet', 'opus', 'haiku'] : config.kind === 'gemini-cli' ? ['auto', 'pro', 'flash'] : [];
  return [...new Set([config.model, ...(config.models ?? []), ...aliases].map(m => m.trim()).filter(Boolean))];
}
export function parseCommandModels(output: string): string[] {
  const clean = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  const models = clean.split(/\r?\n/).flatMap(line => {
    const match = line.trim().match(/^([a-z0-9][a-z0-9._:/-]{1,149})(?:\s{2,}.*)?$/);
    return match && /[-/]/.test(match[1]) ? [match[1]] : [];
  });
  return [...new Set(models)].slice(0, 200);
}

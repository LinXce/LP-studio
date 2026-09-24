import type { ProviderConfig } from '../contracts';
import type { ProviderAdapter, ProviderEvent, ProviderInput } from './types';
import { resolveExecutable, runProcess } from './process';
import { Lines } from './streams';
export function cliArgs(kind: ProviderConfig['kind']): string[] {
  switch (kind) {
    case 'codex-cli': return ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '-c', 'approval_policy="never"', '-'];
    case 'claude-cli': return ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence'];
    case 'gemini-cli': return ['-p', '请处理 stdin 中的完整任务。', '--output-format', 'stream-json', '--approval-mode', 'plan'];
    default: throw Error('不支持的 CLI');
  }
}
export function createCliParser(kind: ProviderConfig['kind'], emit: (e: ProviderEvent) => void) {
  let partial = false;
  return new Lines(line => {
    if (!line.trim()) return;
    let event: any;
    try { event = JSON.parse(line); } catch { emit({ type: 'status', text: line + '\n' }); return; }
    if (event.type === 'error' || event.type === 'turn.failed' || event.is_error || (event.type === 'result' && event.status === 'error')) throw Error(String(event.error?.message ?? event.message ?? event.result ?? 'CLI 返回错误'));
    let text = '';
    if (kind === 'codex-cli') {
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') text = event.item.text ?? '';
      else if (event.type === 'item.completed' && event.item?.type === 'command_execution') emit({ type: 'status', text: `${event.item.command}\n${event.item.aggregated_output ?? ''}\n` });
      else if (event.type === 'thread.started') emit({ type: 'status', text: 'Codex 会话已建立\n' });
    } else if (kind === 'claude-cli') {
      if (event.type === 'stream_event' && event.event?.delta?.type === 'text_delta') { partial = true; text = event.event.delta.text; }
      else if (event.type === 'assistant' && !partial) text = (event.message?.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
    } else if (event.type === 'message' && event.role === 'assistant') text = event.content ?? '';
    if (text) emit({ type: 'text', text });
  });
}
// Interactive launch drops every headless flag so the CLI runs its own TUI in the terminal.
const interactiveDefaults: Partial<Record<ProviderConfig['kind'], { command: string; flag: string }>> = {
  'codex-cli': { command: 'codex', flag: '-m' },
  'claude-cli': { command: 'claude', flag: '--model' },
  'gemini-cli': { command: 'gemini', flag: '-m' },
};
export class CliAdapter implements ProviderAdapter {
  interactive(config: ProviderConfig) {
    const preset = interactiveDefaults[config.kind];
    if (!preset) throw Error('不支持的 CLI');
    return { command: config.executable || preset.command, args: config.model.trim() ? [preset.flag, config.model.trim()] : [] };
  }
  async run({ config, cwd, prompt, signal }: ProviderInput, emit: (event: ProviderEvent) => void) {
    const defaults = { 'codex-cli': 'codex', 'claude-cli': 'claude', 'gemini-cli': 'gemini' };
    const command = config.executable || defaults[config.kind as keyof typeof defaults];
    const launch = await resolveExecutable(command);
    const args = cliArgs(config.kind);
    if (config.model.trim()) args.splice(config.kind === 'codex-cli' ? args.length - 1 : args.length, 0, '--model', config.model.trim());
    const parser = createCliParser(config.kind, emit);
    await runProcess(launch, args, { cwd, signal, input: prompt, stdout: text => parser.push(text), stderr: text => emit({ type: 'status', text }) });
    parser.end();
  }
  async probe(config: ProviderConfig) {
    const command = config.executable || config.kind.replace('-cli', '').replace('claude', 'claude');
    const launch = await resolveExecutable(command); let output = '';
    await runProcess(launch, ['--version'], { cwd: process.cwd(), signal: AbortSignal.timeout(15000), stdout: t => { output += t; }, stderr: t => { output += t; } });
    return output.trim().slice(0, 1000) || '可执行文件可用（未验证登录态）';
  }
}

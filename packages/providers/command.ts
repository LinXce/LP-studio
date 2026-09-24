import type { Grant, ProviderConfig } from '../contracts';
import type { ProviderAdapter, ProviderEvent, ProviderInput } from './types';
import { resolveExecutable, runProcess } from './process';
import { Lines } from './streams';
import { parseCommandModels } from './models';

// Command Code uses wrapped AgentEvent NDJSON, not Claude's stream-json protocol.
// plan mode already blocks writes and shell; --yolo would override it, so the two are mutually exclusive.
export function commandArgs(model = '', grants: Grant[] = []): string[] {
  const unbounded = grants.some(grant => 'all' in grant);
  const args = ['-p', '--output-format', 'json', ...(unbounded ? ['--yolo'] : ['--permission-mode', 'plan']), '--no-session', '--no-skills', '--skip-onboarding', '--no-auto-update'];
  for (const grant of grants) if ('directory' in grant) args.push('--add-dir', grant.directory);
  if (model.trim()) args.push('--model', model.trim());
  return args;
}
function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Command CLI 运行失败，请查看运行日志';
}
// Show what a tool call will touch without echoing file bodies back into the run log.
function toolInputDetail(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const source = input as Record<string, unknown>;
  for (const key of ['file_path', 'path', 'paths', 'pattern', 'include', 'directory', 'target_directory', 'command', 'query', 'url']) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 200);
    if (Array.isArray(value) && value.length) return value.filter(entry => typeof entry === 'string').slice(0, 4).join(', ').slice(0, 200);
  }
  return Object.keys(source).filter(key => !['content', 'text', 'new_string', 'old_string'].includes(key))
    .map(key => `${key}=${String(source[key]).slice(0, 60)}`).join(' ').slice(0, 200);
}
export function createCommandParser(emit: (event: ProviderEvent) => void) {
  let completed = false;
  let turnText = '';
  let hasText = false;
  let separator = false;
  function text(value: string) {
    if (!value) return;
    if (separator) { emit({ type: 'text', text: '\n\n' }); separator = false; }
    emit({ type: 'text', text: value }); hasText = true; turnText += value;
  }
  const lines = new Lines(line => {
    if (!line.trim()) return;
    let frame: any;
    try { frame = JSON.parse(line); } catch { emit({ type: 'status', text: line + '\n' }); return; }
    if (!frame || typeof frame !== 'object') return;
    if (completed) throw Error('Command CLI 在结束帧之后继续输出协议数据');
    if (frame.type === 'result') {
      if (frame.subtype === 'error') throw Error(errorText(frame.error));
      if (frame.subtype === 'max_turns' || frame.stopReason === 'max_turns') throw Error('Command CLI 已达到最大轮数，任务尚未完成');
      if (frame.subtype !== 'success' || ['run_error', 'interrupted'].includes(frame.stopReason)) throw Error('Command CLI 任务未正常完成');
      if (typeof frame.finalText !== 'string') throw Error('Command CLI 结束帧缺少 finalText');
      // A result repeats the final turn's text. Only append a missing suffix/fallback.
      if (frame.finalText.startsWith(turnText)) text(frame.finalText.slice(turnText.length));
      else if (frame.finalText && frame.finalText !== turnText) { separator = hasText; turnText = ''; text(frame.finalText); }
      completed = true;
      return;
    }
    if (frame.type !== 'event' || !frame.event || typeof frame.event !== 'object') return;
    const event = frame.event;
    switch (event.type) {
      case 'turn_start': turnText = ''; separator = hasText; break;
      case 'text_delta': if (typeof event.delta === 'string') text(event.delta); break;
      case 'run_error': throw Error(errorText(event.error));
      case 'interrupted': throw Error('Command CLI 已中断');
      case 'thinking_start': emit({ type: 'status', text: 'Command CLI 正在思考…\n' }); break;
      // The queued frame carries the arguments, so a later denial names the file it wanted.
      case 'tool_queued': {
        const name = String(event.toolName ?? '');
        const detail = toolInputDetail(event.input);
        emit({ type: 'tool', state: 'queued', name, detail });
        emit({ type: 'status', text: `调用工具：${name}${detail ? ` ${detail}` : ''}\n` });
        break;
      }
      case 'tool_running':
      case 'tool_completed':
      case 'tool_errored': emit({ type: 'status', text: `${event.type}: ${String(event.toolName ?? '')}\n` }); break;
      // A denial is the only permission signal a headless run can produce.
      case 'tool_denied': {
        const name = String(event.toolName ?? '');
        emit({ type: 'tool', state: 'denied', name, detail: '' });
        emit({ type: 'status', text: `工具被拒绝：${name}（headless 运行未授权工具）\n` });
        break;
      }
      // Unknown events and run_end snapshots are not assistant text.
    }
  });
  return {
    push: (chunk: string) => lines.push(chunk),
    end: () => { lines.end(); if (!completed) throw Error('Command CLI 输出提前中断，未收到结束帧'); },
  };
}
export class CommandCliAdapter implements ProviderAdapter {
  readonly supportsGrants = true;
  interactive(config: ProviderConfig) {
    // The TUI blocks on a folder-trust prompt and on taste onboarding before it accepts input; without
    // these flags the first Enter only answers those prompts (and the cursor parks at the panel edge,
    // taking the IME candidate window with it). Both are for driving the CLI from this app.
    return { command: config.executable || 'cmdc', args: [...(config.model.trim() ? ['--model', config.model.trim()] : []), '--trust', '--skip-onboarding', '--no-auto-update'] };
  }
  async run({ config, cwd, prompt, signal, grants }: ProviderInput, emit: (event: ProviderEvent) => void) {
    const launch = await resolveExecutable(config.executable || 'cmdc');
    let denied = 0;
    const parser = createCommandParser(event => { if (event.type === 'tool' && event.state === 'denied') denied++; emit(event); });
    try {
      await runProcess(launch, commandArgs(config.model, grants ?? []), {
        cwd, signal, input: prompt,
        stdout: text => parser.push(text), stderr: text => emit({ type: 'status', text }),
        env: { NO_COLOR: '1' },
      });
    } catch (err) {
      if (!denied) throw err;
      throw Error(`${(err as Error).message}\n本机 CLI 在 headless 运行中不授予工具，本次被拒绝 ${denied} 次；模型可能因此没有产出回答。可在对话中授权后重新执行。`);
    }
    parser.end();
  }
  async listModels(config: ProviderConfig) {
    const launch = await resolveExecutable(config.executable || 'cmdc'); let output = '';
    await runProcess(launch, ['--list-models', '--no-auto-update', '--skip-onboarding'], {
      cwd: process.cwd(), signal: AbortSignal.timeout(30000), env: { NO_COLOR: '1' },
      stdout: text => { output += text; if (output.length > 262144) throw Error('模型列表过大'); }, stderr: () => {},
    });
    const models = parseCommandModels(output);
    if (!models.length) throw Error('CLI 未返回可识别的模型列表，可在连接设置中填写模型 ID');
    return models;
  }
  async probe(config: ProviderConfig) {
    const launch = await resolveExecutable(config.executable || 'cmdc');
    let output = '';
    await runProcess(launch, ['--version'], {
      cwd: process.cwd(), signal: AbortSignal.timeout(30000),
      stdout: text => { output += text; }, stderr: text => { output += text; }, env: { NO_COLOR: '1' },
    });
    return `Command CLI (cmdc): ${output.trim().slice(0, 1000) || '可执行文件可用'}\n仅检测安装版本，未验证登录态或模型额度。`;
  }
}

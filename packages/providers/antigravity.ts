import type { ProviderConfig } from '../contracts';
import type { ProviderAdapter, ProviderEvent, ProviderInput } from './types';
import { resolveExecutable, runProcess } from './process';
import { Lines } from './streams';

// Antigravity CLI (agy) print mode: -p keeps the prompt on stdin, stream-json is a typed NDJSON stream.
export function antigravityArgs(model = ''): string[] {
  const args = ['-p', '请处理 stdin 中的完整任务。', '--output-format', 'stream-json', '--mode', 'plan', '--sandbox', '--disable-slash-commands'];
  if (model.trim()) args.push('--model', model.trim());
  return args;
}
function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    if ('message' in error && typeof error.message === 'string') return error.message;
    try { return JSON.stringify(error); } catch { /* fall through to the generic message */ }
  }
  return 'Antigravity CLI 运行失败，请查看运行日志';
}
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => part && typeof part === 'object' && typeof part.text === 'string' ? part.text : '').join('');
  return '';
}
// The stream schema is versioned by the CLI; accept the delta and message shapes it has shipped.
function frameText(frame: Record<string, any>): string {
  const delta = frame.delta ?? frame.event?.delta;
  if (delta && typeof delta === 'object' && typeof delta.text === 'string' && (delta.type === undefined || delta.type === 'text_delta')) return delta.text;
  if (frame.type === 'text_delta' && typeof frame.text === 'string') return frame.text;
  if (frame.type === 'content_block_delta' && typeof frame.delta?.text === 'string') return frame.delta.text;
  if (frame.type === 'assistant' || frame.type === 'message') {
    if (frame.role && frame.role !== 'assistant') return '';
    return contentText(frame.message?.content ?? frame.content);
  }
  return '';
}
export function createAntigravityParser(emit: (event: ProviderEvent) => void) {
  let completed = false;
  let streamed = '';
  function append(value: string) {
    if (!value) return;
    streamed += value;
    emit({ type: 'text', text: value });
  }
  // The final envelope repeats the response; only emit what the deltas have not already produced.
  function settle(finalText: string) {
    if (!finalText) return;
    if (streamed.startsWith(finalText)) return;
    if (streamed && finalText.startsWith(streamed)) { append(finalText.slice(streamed.length)); return; }
    if (streamed) append('\n\n');
    append(finalText);
  }
  const lines = new Lines(line => {
    if (!line.trim()) return;
    let frame: Record<string, any>;
    try { frame = JSON.parse(line); } catch { emit({ type: 'status', text: line + '\n' }); return; }
    if (!frame || typeof frame !== 'object') return;
    if (completed) throw Error('Antigravity CLI 在结束帧之后继续输出协议数据');
    if (frame.type === 'error' || frame.type === 'run_error' || frame.is_error === true) throw Error(errorText(frame.error ?? frame.message ?? frame));
    const isResult = frame.type === 'result' || frame.type === 'final' || typeof frame.response === 'string';
    if (isResult) {
      const status = typeof frame.status === 'string' ? frame.status.toUpperCase() : 'SUCCESS';
      if (!['SUCCESS', 'OK', 'COMPLETED', 'FINAL'].includes(status)) throw Error(errorText(frame.error ?? frame.message ?? `Antigravity CLI 状态：${frame.status}`));
      settle(typeof frame.response === 'string' ? frame.response : contentText(frame.result));
      completed = true;
      return;
    }
    if (typeof frame.event === 'string') { emit({ type: 'status', text: `${frame.event}\n` }); return; }
    const text = frameText(frame);
    if (text) append(text);
  });
  return {
    push: (chunk: string) => lines.push(chunk),
    // Print mode reports failures through the exit code and stderr, so a clean exit without a result frame is still valid.
    end: () => { lines.end(); if (!completed && !streamed) throw Error('Antigravity CLI 输出提前中断，未收到可解析内容'); },
  };
}
function resolveAntigravity(command: string) {
  return resolveExecutable(command || 'agy');
}
export class AntigravityCliAdapter implements ProviderAdapter {
  interactive(config: ProviderConfig) {
    return { command: config.executable || 'agy', args: config.model.trim() ? ['--model', config.model.trim()] : [] };
  }
  async run({ config, cwd, prompt, signal }: ProviderInput, emit: (event: ProviderEvent) => void) {
    const launch = await resolveAntigravity(config.executable);
    const parser = createAntigravityParser(emit);
    await runProcess(launch, antigravityArgs(config.model), {
      cwd, signal, input: prompt,
      stdout: text => parser.push(text), stderr: text => emit({ type: 'status', text }),
      env: { NO_COLOR: '1', AGY_CLI_HIDE_LOGO: '1' },
    });
    parser.end();
  }
  async probe(config: ProviderConfig) {
    const launch = await resolveAntigravity(config.executable); let output = '';
    await runProcess(launch, ['--version'], {
      cwd: process.cwd(), signal: AbortSignal.timeout(30000), env: { NO_COLOR: '1', AGY_CLI_HIDE_LOGO: '1' },
      stdout: text => { output += text; }, stderr: text => { output += text; },
    });
    return `Antigravity CLI (agy): ${output.trim().slice(0, 1000) || '可执行文件可用'}\n仅检测安装版本，未验证登录态或模型额度。`;
  }
}

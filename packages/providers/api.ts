import type { ProviderAdapter, ProviderEvent, ProviderInput } from './types';
import type { ProviderConfig } from '../contracts';
import { SSE } from './streams';
import { setTimeout as delay } from 'node:timers/promises';
export function apiEndpoint(config: ProviderConfig) {
  const defaults: Record<string, string> = { 'openai-api': 'https://api.openai.com/v1', 'anthropic-api': 'https://api.anthropic.com/v1', 'gemini-api': 'https://generativelanguage.googleapis.com/v1beta/openai' };
  const url = new URL(config.baseUrl || defaults[config.kind]);
  if (url.username || url.password || url.search || url.hash) throw Error('API 地址不可含凭证、查询参数或片段');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw Error('API 必须使用 HTTPS；仅本机服务允许 HTTP');
  return url.toString().replace(/\/$/, '') + (config.kind === 'anthropic-api' ? '/messages' : '/chat/completions');
}
export class ApiAdapter implements ProviderAdapter {
  async probe(config: ProviderConfig) { apiEndpoint(config); return '地址格式有效；发送消息时验证密钥与模型（可能产生费用）。'; }
  async run({ config, prompt, key, signal }: ProviderInput, emit: (event: ProviderEvent) => void) {
    if (!key) throw Error('请在模型设置中填写 API Key');
    if (!config.model.trim()) throw Error('请填写平台支持的模型 ID');
    const anthropic = config.kind === 'anthropic-api';
    const body = { model: config.model, messages: [{ role: 'user', content: prompt }], stream: true, ...(anthropic ? { max_tokens: 8192 } : {}) };
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(anthropic ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { Authorization: `Bearer ${key}` }) };
    let response: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(apiEndpoint(config), { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error' });
      if (![429, 502, 503, 529].includes(response.status) || attempt === 2) break;
      await response.body?.cancel();
      const retryAfter = Number(response.headers.get('retry-after'));
      const ms = Math.min(10000, Math.max(500 * 2 ** attempt, (Number.isFinite(retryAfter) ? retryAfter : 0) * 1000));
      emit({ type: 'status', text: `服务繁忙，${ms / 1000}s 后重试（${attempt + 1}/2）\n` });
      await delay(ms, undefined, { signal });
    }
    if (!response?.ok) { await response?.body?.cancel(); throw Error(`API 请求失败：HTTP ${response?.status}。请检查密钥、模型、额度与端点。`); }
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw Error('服务没有返回 SSE 流');
    let done = false; let total = 0;
    const parser = new SSE(data => {
      if (data === '[DONE]') { done = true; return; }
      const event = JSON.parse(data);
      if (event.error || event.type === 'error') throw Error('API 流返回错误，已停止；请检查平台状态');
      if (event.type === 'message_stop') done = true;
      const delta = anthropic ? (event.type === 'content_block_delta' ? event.delta?.text : '') : event.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) emit({ type: 'text', text: delta });
    });
    const reader = response.body.getReader(); const decoder = new TextDecoder();
    try {
      while (true) {
        const item = await reader.read(); if (item.done) break;
        total += item.value.byteLength; if (total > 8 * 1024 * 1024) throw Error('API 输出超过 8 MB');
        parser.push(decoder.decode(item.value, { stream: true }));
      }
      parser.push(decoder.decode()); parser.end();
      if (!done) throw Error('流提前中断，保留已收到内容；未自动重发请求');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}

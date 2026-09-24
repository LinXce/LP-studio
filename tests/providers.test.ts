import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Lines, SSE, Redactor } from '../packages/providers/streams';
import { createCliParser, cliArgs } from '../packages/providers/cli';
import { ApiAdapter, apiEndpoint } from '../packages/providers/api';
import { runProcess } from '../packages/providers/process';
import type { ProviderConfig } from '../packages/contracts';
const config: ProviderConfig = { id: 'x', name: 'test', kind: 'openai-api', model: 'fixture', baseUrl: '', executable: '', timeoutMs: 10000 };
test('JSONL split packets and CRLF are decoded without duplication', () => {
  const output: string[] = []; const p = new Lines(s => output.push(s)); p.push('a\r'); p.push('\nb\nc'); p.end(); assert.deepEqual(output, ['a', 'b', 'c']);
});
test('SSE handles split data, comments, multiline fields and final flush', () => {
  const output: string[] = []; const sse = new SSE(s => output.push(s)); for (const part of [':ping\r\n', 'da', 'ta: one\r\ndata: two\r\n\r', '\ndata: [DONE]']) sse.push(part); sse.end(); assert.deepEqual(output, ['one\ntwo', '[DONE]']);
});
test('redaction holds secret prefixes across chunk boundaries', () => {
  let output = ''; const r = new Redactor(['sk-secret-123'], t => output += t); r.push('hello sk-sec'); assert.equal(output, 'hello '); r.push('ret-123 end'); r.end(); assert.equal(output, 'hello [REDACTED] end');
});
test('CLI decoders normalize provider events and reject errors', () => {
  for (const [kind, event] of [['codex-cli', { type: 'item.completed', item: { type: 'agent_message', text: 'hi' } }], ['claude-cli', { type: 'stream_event', event: { delta: { type: 'text_delta', text: 'hi' } } }], ['gemini-cli', { type: 'message', role: 'assistant', content: 'hi' }]] as const) {
    let output = ''; const p = createCliParser(kind, e => { if (e.type === 'text') output += e.text; }); p.push(JSON.stringify(event) + '\n'); p.end(); assert.equal(output, 'hi');
    assert.throws(() => p.push('{"type":"error","message":"bad"}\n'), /bad/);
  }
  assert.ok(cliArgs('codex-cli').includes('read-only')); assert.ok(cliArgs('claude-cli').includes('--tools')); assert.ok(cliArgs('gemini-cli').includes('plan'));
});
test('API transport rejects credential-bearing or insecure endpoints', () => {
  for (const baseUrl of ['http://example.com/v1', 'https://user:pass@example.com/v1', 'https://example.com?key=x', 'file:///tmp/x']) assert.throws(() => apiEndpoint({ ...config, baseUrl }));
  assert.equal(apiEndpoint({ ...config, baseUrl: 'http://127.0.0.1:8080/v1' }), 'http://127.0.0.1:8080/v1/chat/completions');
});
test('API adapter streams via real local HTTP and rejects truncated output', async t => {
  let truncated = false; let sawKey = false; let requestBody = '';
  const server = createServer(async (req, res) => {
    sawKey = req.headers.authorization === 'Bearer fixture-secret'; for await (const chunk of req) requestBody += chunk;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n'); res.end(truncated ? '' : 'data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const port = (server.address() as any).port; let result = '';
  const input = { config: { ...config, baseUrl: `http://127.0.0.1:${port}/v1` }, key: 'fixture-secret', prompt: 'test', cwd: process.cwd(), signal: AbortSignal.timeout(5000) };
  await new ApiAdapter().run(input, e => { if (e.type === 'text') result += e.text; }); assert.equal(result, '你好'); assert.ok(sawKey); assert.equal(JSON.parse(requestBody).model, 'fixture');
  truncated = true; await assert.rejects(new ApiAdapter().run(input, () => {}), /提前中断/);
});
test('process sends shell metacharacters through stdin literally', async () => {
  let output = ''; const input = '$(whoami) & echo NO; `secret` "中文"';
  await runProcess({ executable: process.execPath, args: [] }, ['-e', 'process.stdin.setEncoding("utf8"); process.stdin.on("data", x => process.stdout.write(x))'], { cwd: process.cwd(), signal: AbortSignal.timeout(5000), input, stdout: t => output += t, stderr: () => {} }); assert.equal(output, input);
});
test('abort terminates a running process', async () => {
  const controller = new AbortController();
  const promise = runProcess({ executable: process.execPath, args: [] }, ['-e', 'process.stdout.write("ready"); setInterval(()=>{},1000)'], { cwd: process.cwd(), signal: controller.signal, stdout: () => controller.abort(Error('test cancel')), stderr: () => {} });
  await assert.rejects(promise, /test cancel/);
});
test('a non-zero exit carries the last stderr lines for the notice', async () => {
  await assert.rejects(
    runProcess({ executable: process.execPath, args: [] }, ['-e', 'console.error("missing credentials"); process.exitCode = 9;'], { cwd: process.cwd(), signal: AbortSignal.timeout(5000), stdout: () => {}, stderr: () => {} }),
    /进程退出码 9：missing credentials/,
  );
});

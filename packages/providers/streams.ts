export class Lines {
  private buffer = '';
  constructor(private consume: (line: string) => void) {}
  push(text: string) {
    this.buffer += text;
    if (this.buffer.length > 2 * 1024 * 1024) throw Error('流事件超过限制');
    let i: number;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, i).replace(/\r$/, ''); this.buffer = this.buffer.slice(i + 1); this.consume(line);
    }
  }
  end() { if (this.buffer) this.consume(this.buffer.replace(/\r$/, '')); this.buffer = ''; }
}
export class SSE {
  private data: string[] = [];
  private lines: Lines;
  constructor(consume: (data: string) => void) {
    this.lines = new Lines(line => {
      if (line === '') { if (this.data.length) consume(this.data.join('\n')); this.data = []; }
      else if (line.startsWith('data:')) this.data.push(line.slice(5).replace(/^ /, ''));
    });
  }
  push(text: string) { this.lines.push(text); }
  end() { this.lines.end(); this.lines.push('\n'); }
}
// Delay a suffix so a secret split across two transport chunks is still redacted.
export class Redactor {
  private pending = '';
  constructor(private secrets: string[], private emit: (text: string) => void) { this.secrets = secrets.filter(Boolean).sort((a,b) => b.length - a.length); }
  push(text: string, final = false) {
    this.pending += text;
    let out = '';
    while (this.pending.length) {
      const secret = this.secrets.find(s => this.pending.startsWith(s));
      if (secret) { out += '[REDACTED]'; this.pending = this.pending.slice(secret.length); continue; }
      if (!final && this.secrets.some(s => s.startsWith(this.pending))) break;
      out += this.pending[0]; this.pending = this.pending.slice(1);
    }
    if (out) this.emit(out);
  }
  end() { this.push('', true); }
}

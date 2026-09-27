/**
 * Phase 0 能力探针 —— 妙搭 full_stack 脚手架挂载版
 * 从 miaoda-phase0/probe-server/server.mjs 移植为 TS；挂载方式见 main.ts：
 *   app.use('/probe', probeHandler)
 * 端点：/api/headers, /api/echo, /api/json/size?kb=N, /api/delay?ms=N,
 *       /api/chunk?n=&gap=, /api/sse/quick|long|large|token
 * 探测页面：优先读 dist/client/probe.html（vite 从 client/public 拷入），缺失时返回内联引导页。
 */
import { readFile } from 'fs/promises';
import { join } from 'path';
import type { Request, Response } from 'express';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function num(v: string | null, def: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function json(res: Response, status: number, obj: unknown) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...CORS,
  });
  res.end(body);
}

function readBody(req: Request, limitBytes = 8 * 1024 * 1024): Promise<{ size: number; text: string }> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error(`body exceeds ${limitBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve({ size, text: Buffer.concat(chunks).toString('utf8') }));
    req.on('error', reject);
  });
}

interface SSEOptions {
  events: number;
  intervalMs: number;
  payloadKB?: number;
  heartbeatMs?: number;
}

async function streamSSE(req: Request, res: Response, { events, intervalMs, payloadKB = 0, heartbeatMs = 5000 }: SSEOptions) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...CORS,
  });
  const start = Date.now();
  let bytes = 0;
  let closed = false;
  const onClose = () => { closed = true; };
  req.on('close', onClose);

  const heartbeat = setInterval(() => {
    if (!closed) res.write(': ping\n\n');
  }, heartbeatMs);

  const perPayload = payloadKB > 0 ? Math.max(1, Math.floor((payloadKB * 1024) / events)) : 0;
  try {
    for (let i = 0; i < events; i++) {
      if (closed) break;
      const data = perPayload ? { i, ts: Date.now(), pad: 'x'.repeat(perPayload) } : { i, ts: Date.now() };
      const frame = `event: probe\ndata: ${JSON.stringify(data)}\n\n`;
      bytes += Buffer.byteLength(frame);
      res.write(frame);
      await sleep(intervalMs);
    }
    if (!closed) {
      const done = `event: done\ndata: ${JSON.stringify({ events, bytes, elapsedMs: Date.now() - start })}\n\n`;
      bytes += Buffer.byteLength(done);
      res.write(done);
    }
  } finally {
    clearInterval(heartbeat);
    req.off('close', onClose);
    res.end();
  }
}

const FALLBACK_PAGE = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>Phase0 Probe</title></head>
<body style="font-family:system-ui;padding:24px">
<h2>Phase 0 探针已挂载 ✓</h2>
<p>探测页面尚未随构建带入（dist/client/probe.html 缺失）。</p>
<p>可直接用 curl 验证端点，例如: <code>curl -N {origin}/probe/api/sse/quick</code></p>
</body></html>`;

let cachedPage: Buffer | null = null;
async function loadProbePage(): Promise<Buffer> {
  if (cachedPage) return cachedPage;
  const candidates = [
    join(process.cwd(), 'dist', 'client', 'probe.html'),
    join(process.cwd(), 'client', 'public', 'probe.html'),
  ];
  for (const p of candidates) {
    try {
      cachedPage = await readFile(p);
      return cachedPage;
    } catch { /* try next */ }
  }
  return Buffer.from(FALLBACK_PAGE);
}

export async function probeHandler(req: Request, res: Response): Promise<void> {
  // Express 挂载 app.use('/probe', ...) 会剥掉前缀，这里 req.url 形如 /api/sse/quick
  const u = new URL(req.url || '/', 'http://probe.local');
  const p = u.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (p === '/' || p === '/index.html') {
    const page = await loadProbePage();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...CORS });
    res.end(page);
    return;
  }
  if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (p === '/health') {
    json(res, 200, { ok: true, ts: Date.now(), uptimeS: Math.round(process.uptime()), node: process.version });
    return;
  }
  if (p === '/api/headers') {
    json(res, 200, { method: req.method, url: req.url, headers: req.headers });
    return;
  }
  if (p === '/api/echo') {
    let body: unknown = null;
    if (req.method === 'POST' || req.method === 'PUT') {
      const { size, text } = await readBody(req);
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch { /* 非 JSON 也允许 */ }
      body = { size, isJson: parsed !== null, sample: text.slice(0, 200) };
    }
    const h = req.headers;
    json(res, 200, {
      method: req.method,
      url: req.url,
      echoHeaders: {
        authorization: h.authorization || null,
        'x-probe': h['x-probe'] || null,
        'content-type': h['content-type'] || null,
        'user-agent': h['user-agent'] || null,
      },
      body,
      ts: Date.now(),
    });
    return;
  }
  if (p === '/api/json/size') {
    const kbv = num(u.searchParams.get('kb'), 100, 1, 10240);
    const t0 = Date.now();
    const pad = new Array(kbv).fill('x'.repeat(1024));
    json(res, 200, { kb: kbv, pad, genMs: Date.now() - t0, ts: Date.now() });
    return;
  }
  if (p === '/api/delay') {
    const ms = num(u.searchParams.get('ms'), 5000, 1, 300000);
    await sleep(ms);
    json(res, 200, { ok: true, delayedMs: ms, ts: Date.now() });
    return;
  }
  if (p === '/api/chunk') {
    const n = num(u.searchParams.get('n'), 20, 1, 1000);
    const gap = num(u.searchParams.get('gap'), 200, 0, 5000);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...CORS });
    res.write('[');
    for (let i = 0; i < n; i++) {
      if (i > 0) res.write(',');
      res.write(JSON.stringify({ i, ts: Date.now() }));
      if (i < n - 1) await sleep(gap);
    }
    res.end(']');
    return;
  }
  if (p === '/api/sse/quick') {
    await streamSSE(req, res, { events: 10, intervalMs: 100 });
    return;
  }
  if (p === '/api/sse/long') {
    const secs = num(u.searchParams.get('secs'), 60, 1, 300);
    const interval = num(u.searchParams.get('interval'), 1000, 100, 10000);
    await streamSSE(req, res, { events: secs, intervalMs: interval });
    return;
  }
  if (p === '/api/sse/large') {
    const kbv = num(u.searchParams.get('kb'), 1024, 1, 10240);
    const events = num(u.searchParams.get('events'), 32, 1, 256);
    await streamSSE(req, res, { events, intervalMs: 50, payloadKB: kbv });
    return;
  }
  if (p === '/api/sse/token') {
    const words = '这是 妙搭 Phase0 逐 token 流式 输出 探测 每个词 一个 事件 用于 验证 打字机 效果'.split(' ');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...CORS,
    });
    let bytes = 0;
    for (const w of words) {
      const frame = `event: token\ndata: ${JSON.stringify({ token: w })}\n\n`;
      bytes += Buffer.byteLength(frame);
      res.write(frame);
      await sleep(120);
    }
    res.write(`event: done\ndata: ${JSON.stringify({ tokens: words.length, bytes })}\n\n`);
    res.end();
    return;
  }

  json(res, 404, { error: 'not found', path: p, hint: '端点清单见 probe.handler.ts 头注释' });
}

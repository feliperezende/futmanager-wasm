// Roda o autoteste da página (?selftest) num Chrome headless em tempo real (necessário para o IndexedDB).
// Uso: node --experimental-websocket tools/headless-selftest.mjs http://127.0.0.1:8080/www/?selftest
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:8080/www/?selftest';
const chrome = process.env.CHROME || 'google-chrome';
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'fm-chrome-'));
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let code = 1;
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch { await sleep(200); }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  if (process.env.CONSOLE) { await send('Runtime.enable'); ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.consoleAPICalled') console.log('[console]', m.params.args.map((a) => a.value).join(' ')); }); }
  await send('Page.navigate', { url });
  let text = '';
  for (let i = 0; i < 120 && !text; i++) {
    await sleep(500);
    const r = await send('Runtime.evaluate', { expression: "document.getElementById('selftest')?.textContent || ''", returnByValue: true });
    text = r.result?.result?.value || '';
  }
  console.log(text || 'SELFTEST_TIMEOUT');
  code = text.includes('SELFTEST_OK') ? 0 : 1;
  ws.close();
} catch (e) { console.log('SELFTEST_ERROR ' + e); }
proc.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(code);

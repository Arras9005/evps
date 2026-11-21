/**
 * 极简浏览器驱动：用 Chrome 的 DevTools 协议做真实点击、输入、截图和深浅色切换。
 * 只用 Node 自带的 WebSocket，没有任何依赖。给界面检查和冒烟测试用，不会被安装到服务器上。
 * 找不到 Chrome 时 launch() 返回 null，调用方应当跳过（而不是失败）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME_BIN,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export function findChrome() {
  return CANDIDATES.find((p) => existsSync(p)) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9333, width = 1280, height = 900, extraArgs = [] } = {}) {
  const bin = findChrome();
  if (!bin) return null;
  const dir = mkdtempSync(join(tmpdir(), 'evps-chrome-'));
  const proc = spawn(bin, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
    `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, `--window-size=${width},${height}`, ...extraArgs, 'about:blank',
  ], { stdio: 'ignore' });

  let wsUrl = '';
  for (let i = 0; i < 100 && !wsUrl; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      wsUrl = (await r.json()).webSocketDebuggerUrl;
    } catch { await sleep(100); }
  }
  if (!wsUrl) { proc.kill('SIGKILL'); throw new Error('Chrome 没有启动'); }

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    } else if (msg.method) listeners.forEach((fn) => fn(msg));
  };
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    id += 1;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => call(method, params, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  const errors = [];
  listeners.push((m) => {
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    // 浏览器自己报的错（内容安全策略拦掉了什么、资源加载失败……）也要当错误：这类问题页面脚本看不到
    // 接口返回 4xx、5xx（模拟「连不上」之类）浏览器也会记一条，那是正常的，不算错误
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/^Failed to load resource: the server responded with a status/.test(m.params.entry.text)) errors.push(`${m.params.entry.text} ${m.params.entry.url ?? ''}`.trim());
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  });

  const api = {
    errors,
    /** 页面的性能计数（累计值，单位秒）：TaskDuration 是主线程总共忙了多久 */
    async metrics() {
      await send('Performance.enable');
      const r = await send('Performance.getMetrics');
      return Object.fromEntries(r.metrics.map((m) => [m.name, m.value]));
    },
    /** 让 Chrome 真的把下载的文件存到这个目录（默认无头模式下载会被丢掉） */
    async downloadsTo(dir) {
      await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true });
    },
    async goto(url) {
      const loaded = new Promise((r) => { const fn = (m) => { if (m.method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(fn), 1); r(); } }; listeners.push(fn); });
      await send('Page.navigate', { url });
      await loaded;
    },
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async waitFor(expression, timeout = 8000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        try { if (await api.eval(`Boolean(${expression})`)) return true; } catch { /* 页面还没准备好 */ }
        await sleep(80);
      }
      throw new Error(`等待超时：${expression}`);
    },
    async rect(selector) {
      return api.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}; })()`);
    },
    async click(selector) {
      const r = await api.rect(selector);
      if (!r) throw new Error(`找不到：${selector}`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    },
    /** 按住元素中心向右（dx）向下（dy）拖，分几步移动，再松开。拖列宽用 */
    async drag(selector, dx, dy = 0, steps = 8) {
      const r = await api.rect(selector);
      if (!r) throw new Error(`找不到：${selector}`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 });
      for (let i = 1; i <= steps; i++) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + (dx * i) / steps, y: r.y + (dy * i) / steps, button: 'left', buttons: 1 });
      }
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x + dx, y: r.y + dy, button: 'left', buttons: 0, clickCount: 1 });
    },
    async dblclick(selector) {
      const r = await api.rect(selector);
      if (!r) throw new Error(`找不到：${selector}`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
      for (const clickCount of [1, 2]) {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount });
      }
    },
    async hover(selector) {
      const r = await api.rect(selector);
      if (r) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
    },
    async focus(selector) { await api.eval(`document.querySelector(${JSON.stringify(selector)}).focus()`); },
    async type(selector, text) {
      await api.click(selector);
      await send('Input.insertText', { text });
    },
    async press(key, { shift = false } = {}) {
      const map = { Enter: { code: 'Enter', vk: 13, text: '\r' }, Escape: { code: 'Escape', vk: 27 }, Tab: { code: 'Tab', vk: 9 }, ArrowDown: { code: 'ArrowDown', vk: 40 }, ArrowUp: { code: 'ArrowUp', vk: 38 }, ArrowLeft: { code: 'ArrowLeft', vk: 37 }, ArrowRight: { code: 'ArrowRight', vk: 39 }, ' ': { code: 'Space', vk: 32, text: ' ' } };
      const k = map[key];
      const modifiers = shift ? 8 : 0;
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: k.code, windowsVirtualKeyCode: k.vk, text: k.text, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: k.code, windowsVirtualKeyCode: k.vk, modifiers });
    },
    async viewport(width, height, scale = 1) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: width < 600 });
    },
    async scheme(value) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
    },
    async shot(path, { full = false } = {}) {
      let clip;
      if (full) {
        const m = await send('Page.getLayoutMetrics');
        const s = m.cssContentSize || m.contentSize;
        clip = { x: 0, y: 0, width: s.width, height: Math.ceil(s.height), scale: 1 };
      }
      const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) });
      writeFileSync(path, Buffer.from(r.data, 'base64'));
    },
    /** 只截一个元素（四周留 pad 像素），给 README 配图用 */
    async shotElement(path, selector, { pad = 12, scale = 2 } = {}) {
      const r = await api.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height }; })()`);
      if (!r) throw new Error(`找不到：${selector}`);
      const clip = { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + pad * 2, height: r.h + pad * 2, scale };
      const shot = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
      writeFileSync(path, Buffer.from(shot.data, 'base64'));
    },
    sleep,
    async close() {
      try { ws.close(); } catch { /* 已关闭 */ }
      proc.kill('SIGKILL');
      await sleep(150);
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* 临时目录，留着也无妨 */ }
    },
  };
  return api;
}

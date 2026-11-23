import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createHttpServer } from '../server/http.ts';
import { Jobs } from '../server/jobs.ts';
import { Store } from '../server/store.ts';
import { isNewer, launchKind } from '../server/update.ts';

describe('新版本比较', () => {
  it('数字逐段比', () => {
    assert.equal(isNewer('0.2.0', '0.1.9'), true);
    assert.equal(isNewer('0.10.0', '0.9.0'), true);
    assert.equal(isNewer('1.0.0', '1.0.0'), false);
    assert.equal(isNewer('0.1.0', '0.2.0'), false);
  });
  it('用 npx 启动的认得出来（Windows、Mac 的缓存路径都认）', () => {
    assert.equal(launchKind('C:\\Users\\a\\AppData\\Local\\npm-cache\\_npx\\1a2b\\node_modules\\@zhangbo9005\\easy-vps\\dist\\web'), 'npx');
    assert.equal(launchKind('/Users/a/.npm/_npx/1a2b/node_modules/@zhangbo9005/easy-vps/dist/web'), 'npx');
    assert.equal(launchKind('/usr/local/lib/node_modules/@zhangbo9005/easy-vps/dist/web'), 'global');
  });
  it('预发布版本、乱写的版本号不算新版本', () => {
    assert.equal(isNewer('0.3.0-beta.1', '0.2.0'), false);
    assert.equal(isNewer('latest', '0.2.0'), false);
  });
});

describe('本机网页服务', () => {
  const token = 'cd'.repeat(24);
  const web = mkdtempSync(join(tmpdir(), 'evps-web-'));
  mkdirSync(join(web, 'assets'));
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>t</title>');
  writeFileSync(join(web, 'assets', 'app-abc123.js'), 'console.log(1)');
  const home = mkdtempSync(join(tmpdir(), 'evps-http-home-'));
  const store = new Store(home);
  let base = '';
  let server: ReturnType<typeof createHttpServer>;

  before(async () => {
    // 端口要先知道才能做 Host 校验：先占一个空闲端口再关掉，用它建服务
    const probe = createHttpServer({ token, port: 0, webDir: web, version: '0.2.0', jobs: new Jobs({ store, vpsScript: '' }), store, promo: { providers: [], intro: '', highlights: [], reasons: [], tips: [] }, onQuit: () => undefined });
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
    const port = (probe.address() as AddressInfo).port;
    await new Promise((r) => probe.close(r));
    server = createHttpServer({
      token, port, webDir: web, version: '0.2.0', jobs: new Jobs({ store, vpsScript: '' }), store,
      promo: { providers: [], intro: '', highlights: [], reasons: [], tips: [] }, onQuit: () => undefined, update: Promise.resolve('0.3.0'),
    });
    await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
    base = `http://127.0.0.1:${port}`;
  });
  after(() => new Promise<void>((r) => server.close(() => r())));

  it('带指纹的 assets 让浏览器长期缓存，index.html 不缓存', async () => {
    const a = await fetch(base + '/assets/app-abc123.js');
    assert.equal(a.status, 200);
    assert.match(a.headers.get('cache-control') ?? '', /immutable/);
    const i = await fetch(base + '/');
    assert.equal(i.headers.get('cache-control'), 'no-store');
    assert.ok(i.headers.get('content-security-policy'));
  });

  it('乱码路径、越界路径都是 404，不是程序出错', async () => {
    assert.equal((await fetch(base + '/%E0%A4%A')).status, 404);
    assert.equal((await fetch(base + '/..%2fpackage.json')).status, 404);
    assert.equal((await fetch(base + '/assets/%00.js')).status, 404);
  });

  it('接口要令牌；新版本号从这里拿', async () => {
    assert.equal((await fetch(base + '/api/update')).status, 401);
    const r = await fetch(base + '/api/update', { headers: { authorization: `Bearer ${token}` } });
    assert.deepEqual(await r.json(), { latest: '0.3.0', current: '0.2.0', via: 'global' });
  });

  it('别的 Host（DNS 重绑定）一律拒绝', async () => {
    // fetch 不让改 Host，用最底层的 http.request
    const status = await new Promise<number>((ok, bad) => {
      const req = request(base + '/api/update', { headers: { authorization: `Bearer ${token}`, host: 'evil.example' } }, (res) => { res.resume(); ok(res.statusCode ?? 0); });
      req.on('error', bad);
      req.end();
    });
    assert.equal(status, 403);
  });
});

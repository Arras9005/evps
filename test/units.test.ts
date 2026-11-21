import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseInstallResult, parseStatus, PROMPTS, stripAnsi } from '../server/geto.ts';
import { remoteCommand } from '../server/jobs.ts';
import { parsePromo } from '../server/promo.ts';
import { newPanelCreds, parseTarget, validHost } from '../server/validate.ts';

describe('parseTarget：用户粘贴什么都尽量认', () => {
  const cases: Array<[string, ReturnType<typeof parseTarget>]> = [
    ['1.2.3.4', { host: '1.2.3.4', port: null, user: null }],
    ['  1.2.3.4  ', { host: '1.2.3.4', port: null, user: null }],
    ['root@1.2.3.4', { host: '1.2.3.4', port: null, user: 'root' }],
    ['1.2.3.4:2222', { host: '1.2.3.4', port: 2222, user: null }],
    ['ssh root@1.2.3.4 -p 2222', { host: '1.2.3.4', port: 2222, user: 'root' }],
    ['ssh -p 2222 root@1.2.3.4', { host: '1.2.3.4', port: 2222, user: 'root' }],
    ['http://1.2.3.4/', { host: '1.2.3.4', port: null, user: null }],
    ['vps.example.com', { host: 'vps.example.com', port: null, user: null }],
    ['2001:db8::1', { host: '2001:db8::1', port: null, user: null }],
    ['[2001:db8::1]:2200', { host: '2001:db8::1', port: 2200, user: null }],
    ['1.2.3.4　', { host: '1.2.3.4', port: null, user: null }],
  ];
  for (const [input, want] of cases) it(JSON.stringify(input), () => assert.deepEqual(parseTarget(input), want));
  for (const bad of ['', '1.2.3', 'a b', '1.2.3.4:99999', 'x;rm -rf /', '1.2.3.256']) {
    it('拒绝 ' + JSON.stringify(bad), () => assert.equal(parseTarget(bad), null));
  }
  it('validHost 不收带 shell 符号的', () => assert.equal(validHost('a$(b)'), false));
});

describe('官方脚本的提问和结果', () => {
  it('三个提问的样子', () => {
    assert.ok(PROMPTS[0]?.re.test('面板端口 [2053]: '));
    assert.ok(PROMPTS[1]?.re.test('面板用户名 [admin]: '));
    assert.ok(PROMPTS[2]?.re.test('面板密码（回车随机）: '));
    assert.ok(!PROMPTS[0]?.re.test('面板端口 [2053]: 3'));
  });
  it('去掉颜色', () => assert.equal(stripAnsi('\x1b[1;32m[OK]\x1b[0m 依赖就绪'), '[OK] 依赖就绪'));
  it('读出地址、用户名、密码', () => {
    const r = parseInstallResult(['==========', '  地址   : http://1.2.3.4:34567', '  用户名 : abc', '  密码   : xyz', '@@EVPS INSTALL_START 2.1.0']);
    assert.deepEqual(r, { address: 'http://1.2.3.4:34567', domainAddress: null, user: 'abc', pass: 'xyz', version: '2.1.0' });
  });
  it('状态行', () => {
    const s = parseStatus(['@@EVPS INSTALLED 1', '@@EVPS UNIT np-panel active enabled', '@@EVPS PASS （请在面板系统设置里重新保存一次后显示）', '@@EVPS USER u']);
    assert.equal(s.installed, true);
    assert.equal(s.pass, null);
    assert.equal(s.user, 'u');
    assert.deepEqual(s.units, [{ name: 'np-panel', active: 'active', enabled: 'enabled' }]);
  });
});

describe('其他', () => {
  it('面板账号随机且格式固定', () => {
    for (let i = 0; i < 200; i += 1) {
      const c = newPanelCreds(22);
      assert.ok(c.port >= 20000 && c.port <= 60000);
      assert.match(c.user, /^[A-Za-z][A-Za-z0-9]{9}$/);
      assert.match(c.pass, /^[A-Za-z0-9]{16}$/);
      assert.doesNotMatch(c.user + c.pass, /[0Oo1lI]/, '不该有容易看错的字符');
    }
  });
  it('远端命令：不是 root 用 sudo，并带上识别用的提示', () => {
    assert.doesNotMatch(remoteCommand('echo hi', 'status', true), /sudo/);
    assert.match(remoteCommand('echo hi', 'status', false), /sudo -p '@@EVPS_SUDO@@ ' bash "\$d\/v.sh" status/);
  });
  it('推荐链接只收 https', () => {
    const reason = 'VPS 的性价比比较高。购买之前建议和客服先沟通一下，要几个 IP 测一下，哪个区的评分高，就去买哪个区的。';
    const p = parsePromo({ providers: [{ name: 'A', url: 'https://a.example/x' }, { name: 'B', url: 'http://b.example' }, { name: 'C', url: 'javascript:alert(1)' }], tips: ['x', 3], reasons: [reason, '没有之一'] });
    assert.deepEqual(p.providers.map((x) => x.name), ['A']);
    assert.deepEqual(p.tips, ['x']);
    assert.deepEqual(p.reasons, [reason, '没有之一']);
  });
  it('推荐页的卖点：缺字段的丢掉，不认识的图标换成对勾', () => {
    const p = parsePromo({ intro: '只是个人推荐', highlights: [{ icon: 'tag', title: '便宜', desc: '很便宜' }, { icon: 'evil', title: '快', desc: '很快' }, { title: '没说明' }] });
    assert.equal(p.intro, '只是个人推荐');
    assert.deepEqual(p.highlights, [{ icon: 'tag', title: '便宜', desc: '很便宜' }, { icon: 'check', title: '快', desc: '很快' }]);
  });
});

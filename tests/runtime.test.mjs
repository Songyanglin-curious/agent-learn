import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { temporary } from './helpers.mjs';

const plugin = await import(process.env.AGENT_LEARN_ENTRY ? pathToFileURL(process.env.AGENT_LEARN_ENTRY).href : '../lib/index.mjs');

/** 用真实消息构造器与工具定义配合公开事件接口，观察插件的续接副作用。 */
function fixture(t, config = {}) {
  const cwd = temporary(t);
  const handlers = new Map();
  const tools = [];
  const sections = [];
  const warnings = [];
  const ctx = {
    agents: { turnBoundaryOf: () => ({ lastTurn: 1 }) },
    on: (name, listener) => handlers.set(name, listener),
    tools: { register: tool => tools.push(tool) },
    systemPrompt: { section: section => sections.push(section) },
    logger: { warn: message => warnings.push(message) },
  };
  plugin.apply(ctx, { rulesDir: join(cwd, 'rules'), ...config });
  const messages = [];
  const agent = { session: { header: { cwd, delegationDepth: 0 } }, steer: message => messages.push(message) };
  const controller = new AbortController();
  return { cwd, handlers, tool: tools[0], sections, warnings, messages, agent, controller,
    stop: turn => handlers.get('agent/turn-stopping')({ agent, turn, signal: controller.signal }) };
}

/** 只在测试工作区写入显式启用标记和学习导航。 */
function enable(f) {
  writeFileSync(join(f.cwd, '.agent-learn.json'), JSON.stringify({ version: 1, enabled: true }));
  writeFileSync(join(f.cwd, 'index.md'), '# 学习入口');
}

// 验证自动检查不会初始化普通目录，并且只在同一个 Agent 的同一轮续接一次。
test('显式启用、同轮去重和下一轮恢复', t => {
  const f = fixture(t);
  f.stop(0);
  assert.equal(f.messages.length, 0);
  assert.equal(existsSync(join(f.cwd, '.agent-learn.json')), false);
  enable(f);
  f.stop(1); f.stop(1);
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].source.kind, 'agent-learn');
  assert.equal(f.messages[0].source.form, 'instructions');
  f.stop(2);
  assert.equal(f.messages.length, 2);
  const sibling = { ...f.agent, session: { header: { cwd: f.cwd } } };
  f.handlers.get('agent/turn-stopping')({ agent: sibling, turn: 2, signal: f.controller.signal });
  assert.equal(f.messages.length, 3);
});

// 验证普通 fork 不被误判为子 Agent，真正的委派与停止状态不产生提醒。
test('子 Agent、取消、关闭、卸载及普通 fork 的边界', t => {
  for (const mode of ['subagent', 'depth', 'cancel', 'disabled', 'disposed', 'fork']) {
    const f = fixture(t, { enabled: mode !== 'disabled' });
    enable(f);
    if (mode === 'subagent') f.agent.session.header.origin = 'subagent';
    if (mode === 'depth') f.agent.session.header.delegationDepth = 1;
    if (mode === 'cancel') f.controller.abort();
    if (mode === 'disposed') f.handlers.get('dispose')();
    if (mode === 'fork') f.agent.session.header.parentSessionId = 'parent';
    f.stop(1);
    assert.equal(f.messages.length, mode === 'fork' ? 1 : 0, mode);
  }
});

// 验证停用、标记损坏、缺少学习入口及子目录均不会误触发。
test('工作区标记按当前目录读取，错误时放行且不重试', t => {
  for (const contents of ['{', '{"version":2,"enabled":true}', '{"version":1,"enabled":false}']) {
    const f = fixture(t);
    enable(f);
    writeFileSync(join(f.cwd, '.agent-learn.json'), contents);
    assert.doesNotThrow(() => { f.stop(1); f.stop(1); });
    assert.equal(f.messages.length, 0);
    assert.ok(f.warnings.length <= 1);
  }
  const missing = fixture(t);
  writeFileSync(join(missing.cwd, '.agent-learn.json'), '{"version":1,"enabled":true}');
  missing.stop(1);
  assert.equal(missing.messages.length, 0);
  const child = fixture(t);
  enable(child);
  const nested = join(child.cwd, '子目录');
  mkdirSync(nested);
  child.agent.session.header.cwd = nested;
  child.stop(1);
  assert.equal(child.messages.length, 0);
});

// 验证只有初始化与显式维护抑制本轮 Hook，教学和配置查询不吞掉维护机会。
test('规则工具分模式抑制，返回学习根目录并保护取消', async t => {
  for (const mode of ['init', 'maintain', 'teaching', 'info']) {
    const f = fixture(t);
    enable(f);
    const result = await f.tool.execute({ mode }, { agent: f.agent, signal: f.controller.signal });
    assert.equal(result.cwd, f.cwd);
    if (mode !== 'info') assert.ok(readFileSync(result.path, 'utf8').length > 0);
    f.stop(1);
    assert.equal(f.messages.length, ['init', 'maintain'].includes(mode) ? 0 : 1, mode);
    f.stop(2);
    assert.equal(f.messages.length, ['init', 'maintain'].includes(mode) ? 1 : 2);
  }
  const f = fixture(t);
  f.controller.abort();
  await assert.rejects(f.tool.execute({ mode: 'init' }, { signal: f.controller.signal }));
  assert.equal(existsSync(join(f.cwd, 'rules')), false);
  await assert.rejects(f.tool.execute({ mode: 'unknown' }, {}));
});

// 验证错误不能破坏停止边界；插件不会因路径或投递失败无限续接。
test('配置错误、缺失会话字段与消息投递异常均放行', t => {
  const invalid = fixture(t, { rulesDir: 'relative' });
  enable(invalid);
  invalid.stop(1); invalid.stop(1);
  assert.equal(invalid.messages.length, 0);
  assert.equal(invalid.warnings.length, 1);
  const broken = fixture(t);
  enable(broken);
  broken.agent.steer = () => { throw new Error('投递失败'); };
  assert.doesNotThrow(() => { broken.stop(1); broken.stop(1); });
  assert.equal(broken.warnings.length, 1);
  const malformed = fixture(t);
  delete malformed.agent.session;
  assert.doesNotThrow(() => malformed.stop(1));
});

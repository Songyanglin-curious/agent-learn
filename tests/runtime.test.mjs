import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
  let lastTurn = 1;
  const ctx = {
    agents: { turnBoundaryOf: () => ({ lastTurn }) },
    on: (name, listener) => handlers.set(name, listener),
    tools: { register: tool => tools.push(tool) },
    systemPrompt: { section: section => sections.push(section) },
    logger: { warn: message => warnings.push(message) },
  };
  plugin.apply(ctx, { rulesDir: join(cwd, 'rules'), ...config });
  const messages = [];
  const agent = {
    session: { header: { cwd, delegationDepth: 0 }, deriveMessages: () => messages },
    steer: message => messages.push(message),
  };
  const controller = new AbortController();
  /** 模拟宿主当前轮次，通过公开工具进入专题教学。 */
  const teach = (turn, currentAgent = agent) => {
    lastTurn = turn;
    return tools[0].execute({ mode: 'teaching' }, { agent: currentAgent, signal: controller.signal });
  };
  /** 发出宿主停止事件，观察当前 Agent 是否收到续接。 */
  const stop = (turn, currentAgent = agent) => handlers.get('agent/turn-stopping')({ agent: currentAgent, turn, signal: controller.signal });
  return { cwd, handlers, tool: tools[0], sections, warnings, messages, agent, controller, teach, stop };
}

/** 只在测试工作区写入显式启用标记和学习导航。 */
function enable(f) {
  writeFileSync(join(f.cwd, '.agent-learn.json'), JSON.stringify({ version: 1, enabled: true }));
  writeFileSync(join(f.cwd, 'index.md'), '# 学习入口');
}

// 验证未配置自定义目录时，公开工具返回实际安装包内规则路径。
test('默认 info 返回安装包内规则', async t => {
  const f = fixture(t, { rulesDir: undefined });
  const previous = process.env.AGENT_LEARN_RULES_DIR;
  delete process.env.AGENT_LEARN_RULES_DIR;
  try {
    const info = await f.tool.execute({ mode: 'info' }, { agent: f.agent, signal: f.controller.signal });
    const entry = process.env.AGENT_LEARN_ENTRY ? pathToFileURL(process.env.AGENT_LEARN_ENTRY) : new URL('../lib/index.mjs', import.meta.url);
    assert.equal(pathToFileURL(info.teaching).href, new URL('../defaults/teaching.md', entry).href);
    assert.equal(pathToFileURL(join(info.rulesDir, 'maintain.md')).href, pathToFileURL(info.maintain).href);
  } finally {
    if (previous === undefined) delete process.env.AGENT_LEARN_RULES_DIR;
    else process.env.AGENT_LEARN_RULES_DIR = previous;
  }
});

// 验证工作区与教学信号都成立才续接，同轮去重且信号不串到其他轮次或 Agent。
test('本轮教学、同轮去重和普通答疑放行', async t => {
  const f = fixture(t);
  await f.teach(1);
  f.stop(1);
  assert.equal(f.messages.length, 0);
  assert.equal(existsSync(join(f.cwd, '.agent-learn.json')), false);
  enable(f);
  f.stop(2);
  assert.equal(f.messages.length, 0);
  await f.teach(3);
  f.stop(3); f.stop(3);
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].source.kind, 'agent-learn');
  assert.equal(f.messages[0].source.form, 'instructions');
  const reminder = f.messages[0].content[0].text;
  assert.match(reminder, /只检查.*已发生.*持久化/);
  assert.match(reminder, /不判断阶段是否完成，不生成总结或开启下一阶段/);
  assert.doesNotMatch(reminder, /单元收束|主题笔记/);
  f.stop(4);
  assert.equal(f.messages.length, 1);
  await f.teach(5);
  f.stop(5);
  assert.equal(f.messages.length, 2);
  const sibling = { ...f.agent, session: { header: { cwd: f.cwd }, deriveMessages: () => [] } };
  f.stop(5, sibling);
  assert.equal(f.messages.length, 2);
  await f.teach(5, sibling);
  f.stop(5, sibling);
  assert.equal(f.messages.length, 3);
});

// 验证普通 fork 不被误判为子 Agent，真正的委派与停止状态不产生提醒。
test('子 Agent、取消、关闭、卸载及普通 fork 的边界', async t => {
  for (const mode of ['subagent', 'depth', 'cancel', 'disabled', 'disposed', 'fork']) {
    const f = fixture(t, { enabled: mode !== 'disabled' });
    enable(f);
    await f.teach(1);
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
test('工作区标记按当前目录读取，错误时放行且不重试', async t => {
  for (const contents of ['{', '{"version":2,"enabled":true}', '{"version":1,"enabled":false}']) {
    const f = fixture(t);
    enable(f);
    writeFileSync(join(f.cwd, '.agent-learn.json'), contents);
    await f.teach(1);
    assert.doesNotThrow(() => { f.stop(1); f.stop(1); });
    assert.equal(f.messages.length, 0);
    assert.equal(f.warnings.length, contents.includes('false') ? 0 : 1);
  }
  const missing = fixture(t);
  writeFileSync(join(missing.cwd, '.agent-learn.json'), '{"version":1,"enabled":true}');
  await missing.teach(1);
  missing.stop(1);
  assert.equal(missing.messages.length, 0);
  const child = fixture(t);
  enable(child);
  const nested = join(child.cwd, '子目录');
  mkdirSync(nested);
  child.agent.session.header.cwd = nested;
  await child.teach(1);
  child.stop(1);
  assert.equal(child.messages.length, 0);
});

// 验证仅教学产生补漏信号，初始化或显式维护可消除本轮的重复提醒。
test('规则工具按模式登记或跳过补漏，返回学习根目录并保护取消', async t => {
  for (const mode of ['init', 'maintain', 'teaching', 'info']) {
    const f = fixture(t);
    enable(f);
    if (mode === 'init' || mode === 'maintain') await f.teach(1);
    const result = await f.tool.execute({ mode }, { agent: f.agent, signal: f.controller.signal });
    assert.equal(result.cwd, f.cwd);
    if (mode !== 'info') assert.ok(readFileSync(result.path, 'utf8').length > 0);
    if (mode === 'teaching') {
      assert.match(result.instruction, /建立或恢复专题计划/);
      assert.match(result.instruction, /阶段综合与专题总综合/);
      const planningPath = join(dirname(result.path), 'planning.md');
      assert.ok(result.instruction.includes(JSON.stringify(planningPath)));
      assert.match(readFileSync(result.path, 'utf8'), /\]\(planning\.md\)/);
      assert.match(readFileSync(planningPath, 'utf8'), /\]\(planning-example\.md\)/);
      assert.doesNotMatch(result.instruction, /单元收束|主题笔记/);
    }
    f.stop(1);
    assert.equal(f.messages.length, mode === 'teaching' ? 1 : 0, mode);
    await f.teach(2);
    f.stop(2);
    assert.equal(f.messages.length, mode === 'teaching' ? 2 : 1);
  }
  const f = fixture(t);
  f.controller.abort();
  await assert.rejects(f.tool.execute({ mode: 'init' }, { signal: f.controller.signal }));
  assert.equal(existsSync(join(f.cwd, 'rules')), false);
  await assert.rejects(f.tool.execute({ mode: 'unknown' }, {}));
});

// 验证错误不能破坏停止边界；插件不会因路径或投递失败无限续接。
test('配置错误、缺失会话字段与消息投递异常均放行', async t => {
  const invalid = fixture(t, { rulesDir: 'relative' });
  enable(invalid);
  await assert.rejects(invalid.teach(1), /rulesDir 必须为绝对路径/);
  invalid.stop(1); invalid.stop(1);
  assert.equal(invalid.messages.length, 0);
  const broken = fixture(t);
  enable(broken);
  await broken.teach(1);
  broken.agent.steer = () => { throw new Error('投递失败'); };
  assert.doesNotThrow(() => { broken.stop(1); broken.stop(1); });
  assert.equal(broken.warnings.length, 1);
  const malformed = fixture(t);
  await malformed.teach(1);
  delete malformed.agent.session;
  assert.doesNotThrow(() => malformed.stop(1));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import Agents from '@deepseek-ai/dsh-agent';
import { temporary } from './helpers.mjs';

const entry = process.env.AGENT_LEARN_ENTRY ? pathToFileURL(process.env.AGENT_LEARN_ENTRY).href : new URL('../lib/index.mjs', import.meta.url).href;
const plugin = await import(entry);

// 使用真实 Cordis 和 DSH 服务验证注册、消息协议、热重载与可选的 agent-docs 共存。
test('真实宿主加载、规则入口、消息入会话、卸载和重新激活', async t => {
  const cwd = temporary(t);
  writeFileSync(join(cwd, '.agent-learn.json'), '{"version":1,"enabled":true}');
  writeFileSync(join(cwd, 'index.md'), '# 学习');
  const ctx = new Context();
  try {
    for (const service of [LlmRuntime, SessionStore, SessionProjections, SystemPrompt, Tools, Agents]) await ctx.plugin(service);
    // 本测试聚焦插件注册与提示词，不执行模型工具批次；显式提供描述器 seam。
    ctx.tools.setExecutor({
      describe: () => ({ schemas: [] }),
      /** 防止测试无意绕过真实模型工具执行路径。 */
      async execute() { throw new Error('本宿主测试不执行模型工具批次'); },
    });
    const config = { rulesDir: join(cwd, '用户规则') };
    const fiber = ctx.plugin(plugin, config);
    await fiber;
    const tool = ctx.tools.get('agent_learn_rules');
    assert.ok(tool);
    const info = await tool.execute({ mode: 'info' }, { signal: new AbortController().signal });
    assert.equal(info.rulesDir, config.rulesDir);
    const assembly = await ctx.systemPrompt.assemble();
    assert.equal(assembly.sections.filter(section => section.name === 'agent-learn:entry').length, 1);
    const session = ctx.sessions.create(SessionId('agent-learn-host'), { meta: { cwd } });
    const messages = [];
    const agent = { session, steer: message => {
      session.append('user/message', message, { surfaceOp: 'append' });
      messages.push(message);
    } };
    const payload = { agent, turn: 1, signal: new AbortController().signal };
    /** 用真实会话事件推进轮次，使规则工具读到宿主投影中的当前轮次。 */
    const beginTurn = turn => session.append('turn/start', { turn });
    beginTurn(1);
    await ctx.serial('agent/turn-stopping', payload);
    assert.equal(messages.length, 0);
    beginTurn(2);
    const teaching = await tool.execute({ mode: 'teaching' }, { agent, signal: payload.signal });
    assert.equal(teaching.cwd, cwd);
    assert.ok(readFileSync(teaching.path, 'utf8').length > 0);
    assert.ok(readFileSync(join(dirname(teaching.path), 'principles.md'), 'utf8').length > 0);
    await ctx.serial('agent/turn-stopping', { ...payload, turn: 2 });
    await ctx.serial('agent/turn-stopping', { ...payload, turn: 2 });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].source.kind, 'agent-learn');
    if (process.env.AGENT_DOCS_ENTRY) {
      mkdirSync(join(cwd, 'docs'));
      writeFileSync(join(cwd, 'docs', 'index.md'), '# 项目文档');
      await ctx.plugin(await import(pathToFileURL(process.env.AGENT_DOCS_ENTRY).href), { rulesDir: join(cwd, 'docs-rules') });
      beginTurn(3);
      await tool.execute({ mode: 'teaching' }, { agent, signal: payload.signal });
      await ctx.serial('agent/turn-stopping', { ...payload, turn: 3 });
      await ctx.serial('agent/turn-stopping', { ...payload, turn: 3 });
      assert.equal(messages.filter(message => message.source.kind === 'agent-learn').length, 2);
      assert.equal(messages.filter(message => message.source.kind === 'agent-docs').length, 1);
    }
    beginTurn(4);
    await tool.execute({ mode: 'teaching' }, { agent, signal: payload.signal });
    await fiber.dispose();
    assert.equal(ctx.tools.get('agent_learn_rules'), undefined);
    assert.equal((await ctx.systemPrompt.assemble()).sections.some(section => section.name === 'agent-learn:entry'), false);
    const before = messages.filter(message => message.source.kind === 'agent-learn').length;
    await ctx.serial('agent/turn-stopping', { ...payload, turn: 4 });
    assert.equal(messages.filter(message => message.source.kind === 'agent-learn').length, before);
    const reactivated = ctx.plugin(plugin, config);
    await reactivated;
    await ctx.serial('agent/turn-stopping', { ...payload, turn: 4 });
    assert.equal(messages.filter(message => message.source.kind === 'agent-learn').length, before);
    beginTurn(5);
    await ctx.tools.get('agent_learn_rules').execute({ mode: 'teaching' }, { agent, signal: payload.signal });
    await ctx.serial('agent/turn-stopping', { ...payload, turn: 5 });
    await ctx.serial('agent/turn-stopping', { ...payload, turn: 5 });
    assert.equal(messages.filter(message => message.source.kind === 'agent-learn').length, before + 1);
    await reactivated.dispose();
  } finally { await ctx.fiber.dispose(); }
});

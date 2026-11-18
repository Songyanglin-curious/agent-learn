import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import { executeToolBatch, ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline';
import Agents from '@deepseek-ai/dsh-agent';
import { temporary } from './helpers.mjs';

const entry = process.env.AGENT_LEARN_ENTRY ? pathToFileURL(process.env.AGENT_LEARN_ENTRY).href : new URL('../lib/index.mjs', import.meta.url).href;
const plugin = await import(entry);

// 使用真实 Cordis 和 DSH 服务验证规则装载、复用和补载，以及插件生命周期。
test('真实宿主中的规则复用、压缩补载、版本更新和插件生命周期', async t => {
  const cwd = temporary(t);
  writeFileSync(join(cwd, '.agent-learn.json'), '{"version":1,"enabled":true}');
  writeFileSync(join(cwd, 'index.md'), '# 学习');
  const ctx = new Context();
  try {
    for (const service of [LlmRuntime, SessionStore, SessionProjections, SystemPrompt, Tools, Agents]) await ctx.plugin(service);
    const pipeline = new ToolExecutionPipeline(ctx);
    ctx.tools.setExecutor({
      describe: () => ({ schemas: [] }),
      /** 直接执行 DSH 工具批次，验证真实工具结果怎样进入会话历史。 */
      execute: input => executeToolBatch(input, pipeline, () => 1),
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
    /** 模拟模型调用教学工具，返回 DSH 实际写入会话的工具结果正文。 */
    const teach = async (turn, step = 1) => {
      const { results: [{ result }] } = await ctx.tools.execute({
        agent, signal: payload.signal, log: { turn, step },
        calls: [{ type: 'tool-call', id: `teaching-${turn}-${step}`, name: tool.name, arguments: '{"mode":"teaching"}' }],
      });
      assert.equal(result.isError, false, JSON.stringify(result.content));
      return result.content;
    };
    beginTurn(1);
    await ctx.serial('agent/turn-stopping', payload);
    assert.equal(messages.length, 0);
    beginTurn(2);
    const initial = await teach(2);
    const teaching = JSON.parse(initial[0].text);
    assert.equal(teaching.cwd, cwd);
    assert.ok(readFileSync(teaching.path, 'utf8').length > 0);
    assert.ok(readFileSync(join(dirname(teaching.path), 'principles.md'), 'utf8').length > 0);
    const maintainPath = join(config.rulesDir, 'maintain.md');
    const initialRule = initial[1].text;
    assert.match(initialRule, /^# Agent Learn 维护规则（maintain\.md，版本 [a-f0-9]+）/);
    assert.ok(initialRule.endsWith(readFileSync(maintainPath, 'utf8')));
    const ruleSeq = session.surface.nodes.at(-1);
    assert.equal((await teach(2, 2)).length, 1);
    await ctx.serial('agent/turn-stopping', { ...payload, turn: 2 });
    await ctx.serial('agent/turn-stopping', { ...payload, turn: 2 });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].source.kind, 'agent-learn');
    assert.equal(messages[0].content.length, 1);
    assert.ok(messages[0].content[0].text.includes(initialRule.split('\n')[0].slice(2)));
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
    assert.equal((await teach(5)).length, 1);
    await ctx.serial('agent/turn-stopping', { ...payload, turn: 5 });
    await ctx.serial('agent/turn-stopping', { ...payload, turn: 5 });
    assert.equal(messages.filter(message => message.source.kind === 'agent-learn').length, before + 1);

    beginTurn(6);
    assert.equal((await teach(6)).length, 1);
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '压缩后保留的学习摘要' }],
      source: { kind: 'test-compaction', form: 'instructions' },
    }), {
      surfaceOp: { op: 'replace', startSeq: ruleSeq, endSeq: ruleSeq }, sourceEventSeqs: [ruleSeq],
    });
    await ctx.serial('agent/turn-stopping', { ...payload, turn: 6 });
    assert.equal(messages.at(-1).content[1].text, initialRule);

    beginTurn(7);
    assert.equal((await teach(7)).length, 1);
    writeFileSync(maintainPath, '# 更新后的维护规则');
    await ctx.serial('agent/turn-stopping', { ...payload, turn: 7 });
    const updatedRule = messages.at(-1).content[1].text;
    assert.ok(updatedRule.endsWith('# 更新后的维护规则'));
    assert.notEqual(updatedRule.split('\n')[0], initialRule.split('\n')[0]);
    assert.ok(messages.at(-1).content[0].text.includes(updatedRule.split('\n')[0].slice(2)));

    beginTurn(8);
    assert.equal((await teach(8)).length, 1);
    await ctx.serial('agent/turn-stopping', { ...payload, turn: 8 });
    assert.equal(messages.at(-1).content.length, 1);
    await reactivated.dispose();
  } finally { await ctx.fiber.dispose(); }
});

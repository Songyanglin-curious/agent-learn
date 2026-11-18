import Schema from '@deepseek-ai/schemastery';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { locateRule, ruleInstruction, rulesDirectory } from './rules.mjs';
import { learningWorkspace } from './workspace.mjs';

export const name = 'agent-learn';
export const inject = ['agents', 'tools', 'systemPrompt'];
export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('启用学习工作区内专题教学轮次的结束补漏检查；关闭后保留显式规则入口。'),
  rulesDir: Schema.string().description('显式自定义规则目录的绝对路径；默认直接读取 DSH 安装包内 defaults，不创建用户副本。'),
});

/** 注册轻量学习路由、规则工具与结束 Hook，所有注册随 Cordis 生命周期释放。 */
export function apply(ctx, config = {}) {
  const defaults = fileURLToPath(new URL('../defaults/', import.meta.url));
  const teachingTurns = new WeakMap();
  const checked = new WeakMap();
  let active = true;
  ctx.on('dispose', () => { active = false; });

  /** 每次使用重新定位规则，保留用户自定义内容并向宿主报告回退原因。 */
  function locate(mode) {
    return locateRule(defaults, rulesDirectory(config.rulesDir), mode, message => ctx.logger.warn(message));
  }

  ctx.systemPrompt.section({
    name: 'agent-learn:entry', order: 650, interpolate: false,
    text: 'Agent Learn 规则路由：每轮实际规划、开始或继续持续学习专题时，调用一次 agent_learn_rules(mode="teaching")，按返回路径读取规则；会话中已读且未变更的规则可复用。本轮的调用是自动补漏的教学信号。仅用户要求建立或恢复学习工作区时用 init；仅维护学习资料时用 maintain。普通一次性问答和非学习任务直接处理，无需调用。',
  });

  ctx.tools.register(defineTool({
    name: 'agent_learn_rules',
    description: 'Agent Learn 规则入口。init 用于显式建立或恢复学习工作区；teaching 用于专题规划、讲解、接续和总结；maintain 仅持久化已发生的变化；info 查看路径。由当前 Agent 读取返回的规则，不启动独立 Agent。',
    parameters: { mode: { type: 'string', enum: ['init', 'teaching', 'maintain', 'info'], required: true } },
    output: {
      schema: { type: 'json' },
      /** 以 JSON 文本向原 Agent 呈现路径和指令。 */
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    /** 返回实际可读规则位置，按轮登记教学，初始化和显式维护跳过同轮补漏。 */
    async execute(args, exec) {
      exec.signal?.throwIfAborted();
      if (!active) throw new Error('Agent Learn 已卸载');
      if (!['init', 'teaching', 'maintain', 'info'].includes(args.mode)) throw new Error('未知规则类型');
      const header = exec.agent?.session?.header;
      const cwd = typeof header?.cwd === 'string' && isAbsolute(header.cwd) ? header.cwd : undefined;
      if (args.mode === 'info') return {
        cwd, rulesDir: rulesDirectory(config.rulesDir),
        init: locate('init'), teaching: locate('teaching'), maintain: locate('maintain'),
      };
      const path = locate(args.mode);
      if (exec.agent) {
        const { lastTurn } = ctx.agents.turnBoundaryOf(exec.agent.session);
        if (args.mode === 'teaching') teachingTurns.set(exec.agent, lastTurn);
        else checked.set(exec.agent, lastTurn);
      }
      return { cwd, path, instruction: ruleInstruction(args.mode, path, cwd) };
    },
  }));

  /** 仅向本轮实际进入专题教学的 Agent 投递一次补漏指令，异常不阻塞宿主。 */
  ctx.on('agent/turn-stopping', ({ agent, turn, signal }) => {
    try {
      if (!active || config.enabled === false || signal.aborted) return;
      if (teachingTurns.get(agent) !== turn) return;
      const header = agent.session.header;
      if (header.origin === 'subagent' || header.delegationDepth > 0) return;
      if (checked.get(agent) === turn) return;
      checked.set(agent, turn);
      const workspace = learningWorkspace(header.cwd);
      if (!workspace) return;
      const path = locate('maintain');
      if (!active || signal.aborted) return;
      agent.steer(createUserMessage({
        content: [{ type: 'text', text: ruleInstruction('maintain', path, workspace) }],
        source: { kind: 'agent-learn', form: 'instructions' },
      }));
    } catch (error) { ctx.logger.warn(`Agent Learn 跳过本轮检查：${error.message}`); }
  });
}

import Schema from '@deepseek-ai/schemastery';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join } from 'node:path';
import { locateRule, maintenanceRule, ruleInstruction, rulesDirectory } from './rules.mjs';
import { learningWorkspace } from './workspace.mjs';

export const name = 'agent-learn';
export const inject = ['agents', 'tools', 'systemPrompt'];
export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('启用学习工作区内专题教学轮次的结束补漏检查；关闭后保留显式规则入口。'),
  rulesDir: Schema.string().description('显式自定义规则目录的绝对路径；默认直接读取 DSH 安装包内 defaults，不创建用户副本。'),
});

/** 检查模型请求使用的会话历史是否仍包含这一版本的完整维护规则。 */
function hasMaintenanceRule(session, rule) {
  return session.deriveMessages().some(message =>
    (message.role === 'tool' || message.source?.kind === 'agent-learn')
    && message.content.some(block => block.type === 'text' && block.text === rule.text));
}

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

  /** 在可自动补漏的教学轮次预先提供维护规则，工作区异常交由轮末检查报告。 */
  function preloadMaintenance(session, teachingPath) {
    if (config.enabled === false || session.header.origin === 'subagent' || session.header.delegationDepth > 0) return;
    try {
      if (!learningWorkspace(session.header.cwd)) return;
      const rule = maintenanceRule(join(dirname(teachingPath), 'maintain.md'));
      if (!hasMaintenanceRule(session, rule)) return rule.text;
    } catch {
      // 教学规则工具仍可使用，轮末检查会记录触发自动补漏时的实际错误。
    }
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
      /** 路径和指令用 JSON 呈现，需要加载的维护正文用独立文本块呈现。 */
      render(_args, { maintenance, ...value }) {
        const content = [{ type: 'text', text: JSON.stringify(value) }];
        if (maintenance !== undefined) content.push({ type: 'text', text: maintenance });
        return content;
      },
    },
    /** 返回实际规则位置，按轮登记教学，按需随工具结果加载维护规则。 */
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
      const result = { cwd, path, instruction: ruleInstruction(args.mode, path, cwd) };
      if (args.mode === 'teaching' && exec.agent) {
        const maintenance = preloadMaintenance(exec.agent.session, path);
        if (maintenance !== undefined) result.maintenance = maintenance;
      }
      return result;
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
      const rule = maintenanceRule(path);
      const content = [{ type: 'text', text: ruleInstruction('maintain', path, workspace, rule.title) }];
      if (!hasMaintenanceRule(agent.session, rule)) content.push({ type: 'text', text: rule.text });
      if (!active || signal.aborted) return;
      agent.steer(createUserMessage({
        content,
        source: { kind: 'agent-learn', form: 'instructions' },
      }));
    } catch (error) { ctx.logger.warn(`Agent Learn 跳过本轮检查：${error.message}`); }
  });
}

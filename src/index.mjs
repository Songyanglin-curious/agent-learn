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
  enabled: Schema.boolean().default(true).description('启用学习工作区的轮次结束补漏检查；关闭后保留显式规则入口。'),
  rulesDir: Schema.string().description('显式自定义规则目录的绝对路径；默认直接读取 DSH 安装包内 defaults，不创建用户副本。'),
});

/** 注册轻量学习路由、规则工具与结束 Hook，所有注册随 Cordis 生命周期释放。 */
export function apply(ctx, config = {}) {
  const defaults = fileURLToPath(new URL('../defaults/', import.meta.url));
  const checked = new WeakMap();
  let active = true;
  ctx.on('dispose', () => { active = false; });

  /** 每次使用重新定位规则，保留用户自定义内容并向宿主报告回退原因。 */
  function locate(mode) {
    return locateRule(defaults, rulesDirectory(config.rulesDir), mode, message => ctx.logger.warn(message));
  }

  ctx.systemPrompt.section({
    name: 'agent-learn:entry', order: 650, interpolate: false,
    text: 'Agent Learn 是学习外骨骼。用户明确开始或继续持续学习时，调用 agent_learn_rules(mode="teaching") 读取教学规则；仅用户要求建立学习工作区或持续跟踪时使用 init。普通一次性问答与非学习任务无需进入学习流程。跟随用户的问题和步幅；在已启用学习工作区内，一个教学单元收束并转向下一单元时主动整理主题笔记和接续状态，无需用户另发记录命令。不要逐轮强制写笔记、考试或推进课程。',
  });

  ctx.tools.register(defineTool({
    name: 'agent_learn_rules',
    description: 'Agent Learn 规则入口。init 仅用于用户明确要求初始化或持续跟踪；teaching 用于长期学习的讲解、接续与按需评估；maintain 检查状态和成果落盘；info 查看路径。返回规则路径后由当前 Agent 读取执行，不启动独立 Agent。',
    parameters: { mode: { type: 'string', enum: ['init', 'teaching', 'maintain', 'info'], required: true } },
    output: {
      schema: { type: 'json' },
      /** 以 JSON 文本向原 Agent 呈现路径和指令。 */
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    /** 返回实际可读规则位置，仅初始化和显式维护抑制当前轮次的重复检查。 */
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
      if (exec.agent && ['init', 'maintain'].includes(args.mode)) checked.set(exec.agent, ctx.agents.turnBoundaryOf(exec.agent.session).lastTurn);
      return { cwd, path, instruction: ruleInstruction(args.mode, path, cwd) };
    },
  }));

  /** 每轮只投递一次补漏指令；过滤子 Agent、取消和非学习工作区，异常不阻塞宿主。 */
  ctx.on('agent/turn-stopping', ({ agent, turn, signal }) => {
    try {
      if (!active || config.enabled === false || signal.aborted) return;
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

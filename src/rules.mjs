import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ruleFiles = ['principles.md', 'spec.md', 'init.md', 'teaching.md', 'maintain.md'];

/** 默认读取安装包内规则；仅显式配置或环境变量启用用户自定义目录。 */
export function rulesDirectory(explicit, env = process.env) {
  const configured = explicit || env.AGENT_LEARN_RULES_DIR;
  if (!configured) return fileURLToPath(new URL('../defaults/', import.meta.url));
  if (!isAbsolute(configured)) throw new Error('rulesDir 必须为绝对路径');
  return resolve(configured);
}

/** 默认规则只读；显式自定义目录仅补齐缺失文件，损坏时整套回退随包规则。 */
export function locateRule(defaultsDir, directory, mode, warn = () => {}) {
  if (!['init', 'teaching', 'maintain'].includes(mode)) throw new Error('未知规则类型');
  if (resolve(directory) === resolve(defaultsDir)) {
    for (const file of ruleFiles) readFileSync(join(defaultsDir, file), 'utf8');
    return join(defaultsDir, `${mode}.md`);
  }
  try {
    mkdirSync(directory, { recursive: true });
    for (const file of ruleFiles) {
      const target = join(directory, file);
      if (!existsSync(target)) {
        try { writeFileSync(target, readFileSync(join(defaultsDir, file)), { flag: 'wx' }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      readFileSync(target, 'utf8');
    }
    return join(directory, `${mode}.md`);
  } catch (error) {
    warn(`Agent Learn 用户规则不可读，回退随包规则：${error.message}`);
    for (const file of ruleFiles) readFileSync(join(defaultsDir, file), 'utf8');
    return join(defaultsDir, `${mode}.md`);
  }
}

/** 返回按模式执行的原 Agent 指令，结束检查只负责补漏而不启动下一课。 */
export function ruleInstruction(mode, path, cwd) {
  const location = JSON.stringify(path);
  const workspace = cwd ? `当前会话工作目录为 ${JSON.stringify(cwd)}。` : '当前没有可确认的会话工作目录。';
  if (mode === 'init') return `${workspace}仅在用户已明确要求建立持续学习或初始化学习工作区时执行。读取 ${location}，确认学习工作区和目标后增量初始化；已有资料保留。不要把插件源码目录自动当作学习工作区，完成后不重复运行结束检查。`;
  if (mode === 'teaching') return `${workspace}读取 ${location}，按当前问题和学习者反馈组织教学；必要时从已启用工作区恢复主线与支线。用户控制方向和步幅；教学单元收束时主动维护主题笔记和接续状态，不等用户另发记录命令。读取教学规则不等于获准初始化或开始新课程。`;
  return `${workspace}本轮即将结束。读取 ${location}，检查是否遗漏必要的学习状态更新、支线收束、成果落盘和接续准备。特别检查本轮是否有教学单元收束并准备转向下一单元：若有，应更新或创建可独立查阅的主题笔记，进度快照不能代替笔记，无需用户另发记录命令。普通非学习任务或无实质变化时直接结束。尊重用户本轮暂停、不要记录或跳过评测的要求。不得仅因 Hook 提醒开启下一课、追加考试或再次初始化；只维护已授权学习工作区中的相关资料，不修改插件规则，不提交 Git，处理后直接结束。`;
}

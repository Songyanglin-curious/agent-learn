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

/** 向当前 Agent 返回模式和规则路径；结束提醒只检查持久化遗漏。 */
export function ruleInstruction(mode, path, cwd) {
  const location = JSON.stringify(path);
  const workspace = cwd ? `当前会话工作目录为 ${JSON.stringify(cwd)}。` : '当前没有可确认的会话工作目录。';
  if (mode === 'init') return `${workspace}仅在用户明确要求建立或恢复学习工作区时执行。读取 ${location}，确认工作区并增量建立或恢复入口；已有资料保留，不把插件源码目录自动当作学习工作区。`;
  if (mode === 'teaching') return `${workspace}读取 ${location}，按其中的生命周期建立或恢复专题计划，组织分阶段教学、阶段综合与专题总综合。读取教学规则不等于获准初始化或开始新专题。`;
  return `${workspace}读取 ${location}，只检查已发生的学习变化是否遗漏持久化。普通非学习任务、用户要求不记录或无遗漏时直接结束。仅维护已授权工作区资料，不判断阶段是否完成，不生成总结或开启下一阶段，不新增评测或初始化。`;
}

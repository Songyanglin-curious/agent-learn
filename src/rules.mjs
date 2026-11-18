import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ruleFiles = ['principles.md', 'spec.md', 'init.md', 'teaching.md', 'maintain.md', 'planning.md', 'planning-example.md'];

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

/** 给维护正文加上带版本的标题，便于提醒指向实际路径下的当前内容。 */
export function maintenanceRule(path) {
  const body = readFileSync(path, 'utf8');
  const version = createHash('sha256').update(path).update('\0').update(body).digest('hex').slice(0, 16);
  const title = `Agent Learn 维护规则（maintain.md，版本 ${version}）`;
  return { title, text: `# ${title}\n供显式维护或轮末补漏时使用。规则文件 ${JSON.stringify(path)}\n\n${body}` };
}

/** 向当前 Agent 指明要使用的规则，轮末提醒优先引用上下文中已有的正文。 */
export function ruleInstruction(mode, path, cwd, maintenanceTitle) {
  const location = JSON.stringify(path);
  const workspace = cwd ? `当前会话工作目录为 ${JSON.stringify(cwd)}。` : '当前没有可确认的会话工作目录。';
  if (mode === 'init') return `${workspace}仅在用户明确要求建立或恢复学习工作区时执行。读取 ${location}，确认工作区并增量建立或恢复入口；已有资料保留，不把插件源码目录自动当作学习工作区。`;
  if (mode === 'teaching') {
    const planning = JSON.stringify(join(dirname(path), 'planning.md'));
    return `${workspace}复用当前上下文中已读且未变更的教学规则；正文不在上下文或已变更时读取 ${location}。按其中的生命周期建立或恢复专题计划，组织分阶段教学、阶段综合与专题总综合。新建专题计划或结构性修订路线时，按需读取 ${planning}；正常接续沿用已有计划。读取教学规则不等于获准初始化或开始新专题。`;
  }
  const rule = maintenanceTitle
    ? `按当前上下文中的「${maintenanceTitle}」执行。只有找不到这一版本的正文时，才读取 ${location}。`
    : `读取 ${location}。`;
  return `${workspace}${rule}只检查已发生的学习变化是否遗漏持久化。普通非学习任务、用户要求不记录或无遗漏时直接结束。仅维护已授权工作区资料，不判断阶段是否完成，不生成总结或开启下一阶段，不新增评测或初始化。`;
}

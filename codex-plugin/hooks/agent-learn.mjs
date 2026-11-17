import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 自动检查只作用于当前目录显式启用的学习工作区。 */
export function learningWorkspace(cwd) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) return false;
  try {
    const marker = JSON.parse(readFileSync(join(cwd, '.agent-learn.json'), 'utf8').replace(/^\uFEFF/, ''));
    return marker?.version === 1 && marker.enabled === true && statSync(join(cwd, 'index.md')).isFile();
  } catch { return false; }
}

/** SessionStart 提醒教学入口；Stop 至多续接一次，由当前 Agent 判断是否需要落盘。 */
export function handleHook(input, pluginRoot = fileURLToPath(new URL('../', import.meta.url))) {
  if (!input || !learningWorkspace(input.cwd)) return {};
  if (input.hook_event_name === 'SessionStart') {
    const skill = join(pluginRoot, 'skills', 'agent-learn', 'SKILL.md');
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext:
      `当前会话工作目录 ${JSON.stringify(input.cwd)} 已启用 Agent Learn。持续学习时读取 ${JSON.stringify(skill)} 并遵循用户与工作区指令；普通非学习任务无需进入学习流程。` } };
  }
  if (input.hook_event_name !== 'Stop' || input.stop_hook_active !== false) return {};
  const maintain = join(pluginRoot, 'skills', 'agent-learn', 'references', 'maintain.md');
  return { decision: 'block', reason:
    `Agent Learn 轮末补漏：当前工作目录为 ${JSON.stringify(input.cwd)}。读取 ${JSON.stringify(maintain)}，依据本轮对话检查学习状态、支线和教学单元收束后的主题笔记。单元收束时进度快照不能代替笔记，无需用户另发记录命令；若本轮已完成维护、用户要求不记录或没有实质变化，直接结束。不得仅因提醒开启下一课、考试或初始化。处理后直接结束。` };
}

/** Hook 标准输入与输出保持单个 JSON；异常不阻断原轮次。 */
function main() {
  try { process.stdout.write(JSON.stringify(handleHook(JSON.parse(readFileSync(0, 'utf8'))))); }
  catch (error) {
    process.stderr.write(`Agent Learn 跳过本轮检查：${error.message}\n`);
    process.stdout.write('{}');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();

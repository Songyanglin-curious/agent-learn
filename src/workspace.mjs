import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** 只检查当前绝对目录的显式标记和根索引，不向上查找或初始化学习工作区。 */
export function learningWorkspace(cwd) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) return undefined;
  let text;
  try { text = readFileSync(join(cwd, '.agent-learn.json'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  const marker = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (!marker || marker.version !== 1 || typeof marker.enabled !== 'boolean') throw new Error('学习工作区标记必须包含 version: 1 和布尔型 enabled');
  if (!marker.enabled) return undefined;
  try {
    if (!statSync(join(cwd, 'index.md')).isFile()) return undefined;
  } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  return cwd;
}

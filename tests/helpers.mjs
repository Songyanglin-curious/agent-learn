import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** 创建限定在系统临时目录内的测试工作区，并在测试结束后清理。 */
export function temporary(t) {
  const path = mkdtempSync(join(tmpdir(), 'agent-learn-'));
  t.after(() => {
    if (dirname(resolve(path)) !== resolve(tmpdir())) throw new Error('拒绝清理临时目录之外的路径');
    rmSync(path, { recursive: true, force: true });
  });
  return path;
}

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** 通过 npm 标准打包链构建 tarball，并生成可回读的 SHA-256 校验清单。 */
function pack() {
  if (!process.env.npm_execpath) throw new Error('请通过 npm run pack 执行，以使用当前 npm 的真实入口');
  const directory = join(root, 'dist');
  mkdirSync(directory, { recursive: true });
  // npm run pack 的 prepack 已完成构建；子进程禁用生命周期，避免构建日志混入 JSON。
  const output = execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--ignore-scripts', '--json', '--pack-destination', directory], { cwd: root, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'inherit'] });
  const [result] = JSON.parse(output);
  const path = join(directory, result.filename);
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
  writeFileSync(join(directory, 'SHA256SUMS.txt'), `${hash}  ${result.filename}\n`);
  console.log(path);
  console.log(`SHA-256: ${hash}`);
}

pack();

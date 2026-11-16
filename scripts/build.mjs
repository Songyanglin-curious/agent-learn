import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** 将运行代码和完整规则源复制成独立可安装产物，不读取项目外的规则。 */
export function build() {
  mkdirSync(join(root, 'lib'), { recursive: true });
  mkdirSync(join(root, 'defaults'), { recursive: true });
  for (const file of ['index.mjs', 'rules.mjs', 'workspace.mjs']) cpSync(join(root, 'src', file), join(root, 'lib', file));
  for (const name of ['principles', 'spec', 'init', 'teaching', 'maintain']) cpSync(join(root, 'rules', `${name}.md`), join(root, 'defaults', `${name}.md`));
  console.log('DSH Agent Learn 已构建。');
}

build();

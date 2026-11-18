import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { locateRule, rulesDirectory, ruleFiles } from '../lib/rules.mjs';
import { temporary } from './helpers.mjs';

const defaults = fileURLToPath(new URL('../defaults/', import.meta.url));

// 验证首次补齐完整规则依赖，并在再次读取时保留用户修改。
test('完整规则首次创建、用户文件不覆盖与实时重读', t => {
  const directory = join(temporary(t), '用户规则');
  const path = locateRule(defaults, directory, 'teaching');
  for (const file of ruleFiles) assert.equal(readFileSync(join(directory, file), 'utf8'), readFileSync(join(defaults, file), 'utf8'));
  writeFileSync(path, '# 用户自定义教学');
  assert.equal(locateRule(defaults, directory, 'teaching'), path);
  assert.equal(readFileSync(path, 'utf8'), '# 用户自定义教学');
});

// 验证升级旧规则目录时，教学入口与范例都可在原目录使用，定制规则仍由用户维护。
test('旧版自定义目录补齐规划规则和范例', t => {
  const directory = temporary(t);
  for (const file of ['principles.md', 'spec.md', 'init.md', 'teaching.md', 'maintain.md']) {
    cpSync(join(defaults, file), join(directory, file));
  }
  const customTeaching = '# 既有自定义教学';
  writeFileSync(join(directory, 'teaching.md'), customTeaching);

  const teachingPath = locateRule(defaults, directory, 'teaching');
  assert.equal(readFileSync(teachingPath, 'utf8'), customTeaching);
  const planningPath = join(dirname(teachingPath), 'planning.md');
  const planning = readFileSync(planningPath, 'utf8');
  assert.equal(planning, readFileSync(join(defaults, 'planning.md'), 'utf8'));
  assert.match(planning, /\]\(planning-example\.md\)/);
  assert.equal(readFileSync(join(dirname(planningPath), 'planning-example.md'), 'utf8'), readFileSync(join(defaults, 'planning-example.md'), 'utf8'));
});

// 验证任一依赖不可读时回退整个随包规则目录，避免混用损坏的相对引用。
test('依赖损坏时回退随包规则，不覆盖损坏位置', t => {
  const directory = temporary(t);
  mkdirSync(join(directory, 'principles.md'));
  const warnings = [];
  const result = locateRule(defaults, directory, 'maintain', warning => warnings.push(warning));
  assert.equal(result, join(defaults, 'maintain.md'));
  assert.equal(warnings.length, 1);
  assert.throws(() => locateRule(defaults, directory, 'other'));
});

// 验证显式配置优先，环境变量隔离于 agent-docs，拒绝相对路径。
test('规则路径优先级与默认目录', () => {
  const explicit = resolve('规则一');
  const environment = resolve('规则二');
  assert.equal(rulesDirectory(explicit, { AGENT_LEARN_RULES_DIR: environment }), explicit);
  assert.equal(rulesDirectory(undefined, { AGENT_LEARN_RULES_DIR: environment }), environment);
  assert.throws(() => rulesDirectory('relative', {}));
  assert.equal(resolve(rulesDirectory(undefined, {})), resolve(defaults));
});

// 验证默认读取不创建副本，升级立即可见，显式自定义文件继续保留。
test('包内默认规则只读且随升级更新，自定义规则独立保留', t => {
  const root = temporary(t);
  const packaged = join(root, 'DSH 安装目录', 'defaults');
  cpSync(defaults, packaged, { recursive: true });
  const custom = join(root, '显式自定义');
  const customPath = locateRule(packaged, custom, 'teaching');
  writeFileSync(customPath, '# 自定义教学');
  assert.equal(locateRule(packaged, packaged, 'teaching'), join(packaged, 'teaching.md'));
  writeFileSync(join(packaged, 'teaching.md'), '# 新版默认教学');
  assert.equal(readFileSync(locateRule(packaged, packaged, 'teaching'), 'utf8'), '# 新版默认教学');
  assert.equal(readFileSync(locateRule(packaged, custom, 'teaching'), 'utf8'), '# 自定义教学');
  assert.deepEqual(readdirSync(root).sort(), ['DSH 安装目录', '显式自定义'].sort());
});

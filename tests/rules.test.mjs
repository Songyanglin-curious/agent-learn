import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
  assert.ok(rulesDirectory(undefined, {}).endsWith(join('.agent-learn', 'dsh')));
});

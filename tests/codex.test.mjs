import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { handleHook, learningWorkspace } from '../codex-plugin/hooks/agent-learn.mjs';
import { temporary } from './helpers.mjs';

const pluginRoot = join(import.meta.dirname, '..', 'codex-plugin');

function enable(cwd) {
  writeFileSync(join(cwd, '.agent-learn.json'), '{"version":1,"enabled":true}');
  writeFileSync(join(cwd, 'index.md'), '# 学习入口');
}

test('Codex Hook 只在当前目录显式启用时续接，并在同轮仅续接一次', t => {
  const cwd = temporary(t);
  const input = { hook_event_name: 'Stop', cwd, turn_id: 'turn-1', stop_hook_active: false };
  assert.deepEqual(handleHook(input), {});
  enable(cwd);
  assert.equal(learningWorkspace(cwd), true);
  const result = handleHook(input);
  assert.equal(result.decision, 'block');
  assert.match(result.reason, /主题笔记/);
  assert.ok(existsSync(join(pluginRoot, 'skills', 'agent-learn', 'references', 'maintain.md')));
  assert.deepEqual(handleHook({ ...input, stop_hook_active: true }), {});
  assert.deepEqual(handleHook({ ...input, hook_event_name: 'Interrupt' }), {});
  writeFileSync(join(cwd, '.agent-learn.json'), '{"version":1,"enabled":false}');
  assert.deepEqual(handleHook(input), {});
  writeFileSync(join(cwd, '.agent-learn.json'), '{');
  assert.deepEqual(handleHook(input), {});
});

test('Codex 会话开始只向已启用工作区提供教学入口', t => {
  const cwd = temporary(t);
  enable(cwd);
  const result = handleHook({ hook_event_name: 'SessionStart', cwd, source: 'startup' });
  assert.equal(result.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(result.hookSpecificOutput.additionalContext, /SKILL\.md/);
  assert.deepEqual(handleHook({ hook_event_name: 'SessionStart', cwd: join(cwd, 'nested') }), {});
});

test('Codex 安装目录中的命令 Hook 读取 JSON 并输出合法续接决策', t => {
  const cwd = temporary(t);
  enable(cwd);
  const manifest = JSON.parse(readFileSync(join(pluginRoot, '.codex-plugin', 'plugin.json'), 'utf8'));
  const hooks = JSON.parse(readFileSync(join(pluginRoot, 'hooks', 'hooks.json'), 'utf8'));
  assert.equal(manifest.name, 'codex-agent-learn');
  assert.ok(hooks.hooks.Stop?.length && hooks.hooks.SessionStart?.length);
  const run = spawnSync(process.execPath, [join(pluginRoot, 'hooks', 'agent-learn.mjs')], {
    input: JSON.stringify({ hook_event_name: 'Stop', cwd, stop_hook_active: false }), encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).decision, 'block');
});

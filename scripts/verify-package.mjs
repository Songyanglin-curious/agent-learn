import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ruleFiles } from '../src/rules.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

/** 检查独立 TGZ 的完整性与宿主行为，并用破坏去重和消息来源的变体证明关键断言有效。 */
function verify() {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const filename = `${manifest.name}-${manifest.version}.tgz`;
  const archive = join(root, 'dist', filename);
  const checksum = createHash('sha256').update(readFileSync(archive)).digest('hex');
  assert.equal(readFileSync(join(root, 'dist', 'SHA256SUMS.txt'), 'utf8').trim(), `${checksum}  ${filename}`);
  const temp = mkdtempSync(join(tmpdir(), 'agent-learn-package-'));
  try {
    const tar = process.env.AGENT_LEARN_TAR || 'tar';
    const entries = execFileSync(tar, ['-tf', archive], { encoding: 'utf8', timeout: 10000 }).trim().split(/\r?\n/);
    for (const entry of entries) assert.ok(entry.startsWith('package/') && !entry.split('/').includes('..'), `包路径越界：${entry}`);
    for (const file of ['package.json', 'README.md', 'cordis.patch.yml', 'lib/index.mjs', 'lib/rules.mjs', 'lib/workspace.mjs', ...ruleFiles.map(name => `defaults/${name}`)]) assert.ok(entries.includes(`package/${file}`), `缺少发行文件：${file}`);
    assert.ok(entries.every(entry => !/^package\/(node_modules|src|tests|docs|dist)\//.test(entry)), '发行包不应包含开发目录或机器依赖');
    execFileSync(tar, ['-xf', archive, '-C', temp], { timeout: 10000 });
    const unpacked = join(temp, 'package');
    for (const file of ['index.mjs', 'rules.mjs', 'workspace.mjs']) assert.deepEqual(readFileSync(join(unpacked, 'lib', file)), readFileSync(join(root, 'src', file)));
    for (const file of ruleFiles) assert.deepEqual(readFileSync(join(unpacked, 'defaults', file)), readFileSync(join(root, 'rules', file)));
    assert.equal(JSON.parse(readFileSync(join(unpacked, 'package.json'), 'utf8')).version, manifest.version);
    // 独立解压包只复用已核对的宿主依赖，不通过原仓库路径加载运行代码或默认规则。
    symlinkSync(realpathSync(join(root, 'node_modules')), join(unpacked, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = spawnSync(process.execPath, ['--test', 'tests/runtime.test.mjs', 'tests/host.test.mjs'], {
      cwd: root, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, AGENT_LEARN_ENTRY: join(unpacked, 'lib', 'index.mjs') },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    console.log(result.stdout);
    const original = readFileSync(join(unpacked, 'lib', 'index.mjs'), 'utf8');
    for (const [label, before, after, failure] of [
      ['破坏同轮去重', 'if (checked.get(agent) === turn) return;', '', /同轮去重/],
      ['破坏消息来源', "kind: 'agent-learn'", "kind: 'plugin'", /plugin|消息来源|agent-learn/],
    ]) {
      assert.ok(original.includes(before), `变异位置不存在：${label}`);
      const mutant = join(temp, label);
      mkdirSync(mutant);
      cpSync(join(unpacked, 'lib'), join(mutant, 'lib'), { recursive: true });
      cpSync(join(unpacked, 'defaults'), join(mutant, 'defaults'), { recursive: true });
      symlinkSync(realpathSync(join(root, 'node_modules')), join(mutant, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
      writeFileSync(join(mutant, 'lib', 'index.mjs'), original.replace(before, after));
      const broken = spawnSync(process.execPath, ['--test', 'tests/runtime.test.mjs'], {
        cwd: root, encoding: 'utf8', timeout: 30000,
        env: { ...process.env, AGENT_LEARN_ENTRY: join(mutant, 'lib', 'index.mjs') },
      });
      assert.ok(broken.status !== 0 && broken.status !== null && /AssertionError/.test(broken.stdout + broken.stderr) && failure.test(broken.stdout + broken.stderr), `${label} 未被行为断言捕获：${broken.stdout}${broken.stderr}`);
      console.log(`${label}：行为门禁按预期失败。`);
    }
    console.log(`发行包 SHA-256、完整性、源码一致性和独立宿主检查通过：${filename}`);
  } finally {
    if (dirname(resolve(temp)) !== resolve(tmpdir())) throw new Error('拒绝清理临时目录之外的路径');
    rmSync(temp, { recursive: true, force: true });
  }
}

verify();

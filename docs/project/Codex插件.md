# Codex 本地插件

`codex-plugin/` 是与 DSH Bundle 独立的 Codex 插件，标识为 `codex-agent-learn`，初始版本 0.1.0。采用当前 Codex 支持的 `.codex-plugin/plugin.json` 兼容清单，包含 `agent-learn` Skill 和本地命令 Hook；没有 MCP 服务或独立模型。

## 行为

- `SessionStart`：仅在当前 cwd 存在有效 `.agent-learn.json` 与 `index.md` 时，提示当前 Agent 读取插件 Skill。不会初始化或写入资料。
- `Stop`：在同一显式启用的工作区最多续接一次，让当前 Agent 按维护规则检查实质状态变化、支线与单元收束笔记。`stop_hook_active` 为 true 时放行，避免续接循环。
- Skill：用户明确要求初始化时读 init；持续学习时读 teaching；出现实质变化或单元收束时读 maintain。规则存于插件自身的 `skills/agent-learn/references/`，学习数据只写入用户指定工作区。Codex 不使用 DSH 的 `agent_learn_rules` 工具。

工作区启用标记与 DSH 版兼容：当前 cwd 的 `.agent-learn.json` 必须为 `version: 1`、`enabled: true`，且存在根 `index.md`。不向父目录搜索；标记无效、缺失或停用时，Hook 直接放行。用户本轮要求不记录时，Agent 不落盘。插件 Hook 只注入提示，不直接生成或修改笔记。

## 本机安装

在仓库根目录执行以下 PowerShell 命令，将插件复制到个人目录：

```powershell
Copy-Item -LiteralPath .\codex-plugin -Destination "$env:USERPROFILE\.codex\plugins\agent-learn" -Recurse
```

在个人 `~/.agents/plugins/marketplace.json` 的 `plugins` 数组中增量加入以下条目，保留原有插件：

```json
{
  "name": "codex-agent-learn",
  "source": { "source": "local", "path": "./.codex/plugins/agent-learn" },
  "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
  "category": "Productivity"
}
```

运行 `codex plugin add codex-agent-learn@personal-local`，再用 `codex plugin list --json` 回读安装与启用状态。重启 Codex 桌面端后，在 **Settings > Hooks** 审阅并信任 `codex-agent-learn` 的两个命令 Hook；Codex 在信任前会跳过它们。安装或升级后使用新聊天验证 Skill 与 Hook，避免把旧聊天的加载状态误作本版行为。

## 验证边界

`npm test` 包含 Hook 协议、显式工作区边界、单轮续接和命令行 JSON 测试。这些测试验证触发与提示协议，不证明真实模型已经生成学习笔记。实际验收需在已启用学习工作区完成一个教学单元，确认主题笔记写入且由领域索引可达，并区分“讲过”“够用”和“独立掌握”。

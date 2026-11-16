# agent-learn

学习外骨骼：用轻量 Hook 与可编辑 Markdown 规则，辅助学习接续、状态维护和成果沉淀。跟随学习者的问题和步幅，不强推课程、考试或逐轮记录。

当前提供 **DSH 插件 `dsh-agent-learn` 0.1.0**，不包含 Codex 插件。目标运行时为 DSH 0.2.2-rc.1、Cordis 4.1.0、Node.js 22 及以上。宿主应已提供 agents、tools、systemPrompt，以及正常使用的文件读写工具。

## 安装

从 GitHub 克隆并构建安装包，需要 Git、Node.js 22+ 和已安装的 DSH。以下命令在 PowerShell 执行，Profile 使用 learn，可按实际名称替换：

```powershell
git clone https://github.com/Songyanglin-curious/agent-learn.git
Set-Location agent-learn
npm run pack
dsh plugin --profile learn add "$(Join-Path $PWD.Path 'dist/dsh-agent-learn-0.1.0.tgz')"
```

构建只使用 Node.js 内置模块，无需先安装开发依赖。源码已有本地副本时，在仓库目录执行 `git pull --ff-only`，再运行打包与安装命令；已有本地改动时先处理，避免覆盖。

安装后只查看第一层插件标识和名称：

```powershell
dsh --profile learn --dump-config |
  Where-Object { $_ -match '^- (id|name):|^  (id|name):' }
```

确认出现 id 为 agent-learn、name 为 dsh-agent-learn 的条目，再按宿主需要重新加载对应实例。构建还会生成 dist/SHA256SUMS.txt，可用 Get-FileHash -Algorithm SHA256 核对包哈希。构建本身不会安装插件，只有 dsh plugin add 会修改指定 Profile；不要绕过宿主版本兼容门禁。

## 开始使用

在计划存放学习资料的目录打开 DSH 会话，明确告诉 Agent：

> 在当前目录初始化持续学习工作区，我想学习 X，主要用于 Y。

Agent 通过 `agent_learn_rules` 的 init 模式读取初始化规则，复用已有资料，建立最小学习索引、计划和进度，再创建 `.agent-learn.json`：

```json
{ "version": 1, "enabled": true }
```

工作区根目录同时需要 `index.md`。后续会话 cwd 应仍指向该根目录；在子目录或其他目录聊天不会自动向上查找或绑定学习工作区。标记设为 false 可停用自动检查。仅安装插件不会扫描或初始化其他目录。

日常可以直接问问题或继续学习。插件提供简短教学路由；普通一次性问答无需进入持续学习流程。状态变化时维护主线、支线、证据和接续位置；形成可复用认识时按需整理笔记。无需每次显式要求记录。

## 规则与配置

工具 `agent_learn_rules` 提供四种模式：init 初始化、teaching 教学与阶段判断、maintain 显式补漏维护、info 查看实际路径。初始化和维护由原 Agent 读取规则执行，插件本身不生成学习内容，也不直接写学习档案。

默认用户规则位于 `~/.agent-learn/dsh`；优先级是插件配置 rulesDir、环境变量 AGENT_LEARN_RULES_DIR、默认目录。自定义目录必须是绝对路径。

首次调用只补齐缺失的五份规则，不覆盖用户文件；每次调用重新检查可读性，依赖损坏时整套回退随包 defaults。源码 rules 的更新不会自动覆盖既有用户规则。修改自定义规则后下次读取生效；不要编辑 lib/defaults 等构建副本。

插件配置 enabled=false 关闭自动轮次 Hook，但保留显式规则工具和轻量教学路由。自动 Hook 还要求当前 cwd 具有有效启用标记与根索引。

## 工作方式与限制

- 正常教学规则协调节奏；每轮停止前由 Hook 最多提醒一次原 Agent 补漏，不运行独立 Agent。
- 检查不意味着必须写文件、继续讲课或考试。用户暂停、不记录或跳过练习的要求优先。
- 子 Agent、取消、卸载和配置异常时不续接；错误记录到宿主日志并放行正常工作。
- 多个 Hook 可以各自续接一次；本插件不控制其他插件的提醒，也不承诺零额外模型开销。
- 插件依赖原 Agent 的判断、文件能力及权限，不能保证学习诊断或专业知识准确。真实教学节奏与自动落盘效果仍需实际对话验收。

## 开发

安装匹配 package.json 的开发依赖后：

```powershell
npm test
npm run pack
npm run verify:package
```

src 是运行代码源，rules 是五份默认规则的唯一源；build 生成 lib 与 defaults。verify:package 需要系统 tar 和匹配的本地宿主依赖，会独立解压 TGZ、比对源码与规则、验证宿主加载并检查两项关键行为断言确实可失败。测试覆盖公开事件接口和真实 Cordis/DSH 服务，不把测试 Agent 当成真实模型闭环。

开发文档位于源码仓库 docs/index.md；独立 TGZ 只携带运行代码、默认规则、配置补丁和本说明，不依赖仓库之外的文件。

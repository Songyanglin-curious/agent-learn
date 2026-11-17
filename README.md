# agent-learn

学习外骨骼：用轻量 Hook 与可编辑 Markdown 规则，辅助学习接续、状态维护和成果沉淀。跟随学习者的问题和步幅，不强推课程、考试或逐轮记录。

当前提供 **DSH 插件 `dsh-agent-learn` 0.1.1**，不包含 Codex 插件。目标运行时为 DSH 0.2.2-rc.1、Cordis 4.1.0、Node.js 22 及以上。宿主应已提供 agents、tools、systemPrompt，以及正常使用的文件读写工具。

## 安装

直接安装 GitHub Release 的固定版本 TGZ，无需克隆源码或本地构建。需要已安装 DSH；以下 PowerShell 命令使用 learn Profile，可按实际名称替换。升级到本版也执行同一命令：

```powershell
dsh plugin --profile learn add 'https://github.com/Songyanglin-curious/agent-learn/releases/download/v0.1.1/dsh-agent-learn-0.1.1.tgz'
```

安装包与 SHA256SUMS.txt 位于 [v0.1.1 Release](https://github.com/Songyanglin-curious/agent-learn/releases/tag/v0.1.1)。远程安装不要添加 --offline。

需要从源码构建时，在仓库目录执行 npm run pack，再安装本地 dist/dsh-agent-learn-0.1.1.tgz；构建仅依赖 Node.js 内置模块。

安装后只查看第一层插件标识和名称：

```powershell
dsh --profile learn --dump-config |
  Where-Object { $_ -match '^- (id|name):|^  (id|name):' }
```

确认出现 id 为 agent-learn、name 为 dsh-agent-learn 的条目，再按宿主需要重新加载对应实例。构建还会生成 dist/SHA256SUMS.txt，可用 Get-FileHash -Algorithm SHA256 核对包哈希。构建本身不会安装插件，只有 dsh plugin add 会修改指定 Profile；不要绕过宿主版本兼容门禁。

卸载指定 Profile 中的插件：

```powershell
dsh plugin --profile learn remove dsh-agent-learn
```

显式自定义规则和旧版用户文件属于用户内容，卸载不自动删除；共享包管理缓存由 DSH 管理。

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

默认直接读取 DSH Profile 安装包内的 `defaults/`，随包升级，不再创建 `C:/Users/DELL/.agent-learn` 或其他用户根目录副本。调用 `agent_learn_rules(mode="info")` 查看实际路径。优先级为插件配置 rulesDir、环境变量 AGENT_LEARN_RULES_DIR、包内 defaults。

需要自定义时，显式将 rulesDir 或 AGENT_LEARN_RULES_DIR 设为绝对目录，建议选择 DSH_HOME 下的 agent-learn/rules。只有显式自定义目录会补齐缺失的五份规则，已有文件保留；依赖不可读时整套回退包内 defaults。自定义内容不会随包升级，修改后下次读取生效；默认包内文件由包管理器管理，请勿直接编辑。

旧版 `~/.agent-learn/dsh` 不再自动读取，也不自动迁移或删除。要继续使用旧自定义内容，请自行移至 DSH 目录并显式配置新路径；若仍配置旧路径或环境变量，请清除或修改它，才能使用新版默认规则。

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

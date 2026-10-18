# dsh-nu

[English](../../README.md) | 中文

dsh-nu 强制 DeepSeek Harness 用 Nushell 执行所有 shell 命令，禁用 `bash` / `pwsh` 执行器。

它通过 DeepSeek Harness 提供的底层扩展接口，在运行时把 `bash` / `pwsh` 执行器换成 Nushell 执行器。每次 shell 调用都是一个独立进程：

```text
nu --no-config-file -c "<command>"
```

dsh 侧仍是同一个 `bash` / `pwsh` 工具，调用方式不变；沙箱（`dsh-sandbox-local` 与 `dsh-sandbox-policy`）也照常工作，其他 dsh 插件无需改代码。插件把模型看到的 shell 工具描述换成 Nushell 版本，并在 system prompt 里加入一小节规则和语法指南；这部分教学内容会占用上下文，关掉后模型调用 shell 工具时会频繁报错。命令如果把工作交给其他 shell，预检会在进程启动前拒绝它；bash 和 PowerShell 习惯也会在启动前被拦下，并给出对应的 Nushell 写法。

## 状态

0.2.0 已发布到 npm。当前测试组合是 dsh `0.2.1-rc.2` 与 Nushell `0.115.1`，记录在 `package.json` 的 `testedWith` 里。

## 兼容性

dsh-nu 只支持这一组合。peer 依赖只覆盖 dsh 家族；启动时如果安装的 dsh 或 Nushell 与测试组合不同，会输出警告。其他版本没有测试过。

## 安装

需要 `PATH` 上有 dsh `0.2.1-rc.2` 和 Nushell `0.115.1`。

把 bundle 装进 dsh profile：

```sh
dsh plugin --profile tui add dsh-nu@0.2.0
```

浏览器界面把 `--profile` 换成 `web`。第一次运行 `dsh plugin` 会创建 profile；bundle 的 patch 会停用平台 shell 执行器，挂载 Nushell 执行器和教学层。用 `dsh tui`（或 `dsh web`）启动。

刚发布时，pnpm 可能因为 `minimumReleaseAge` 报 `ERR_PNPM_NO_MATURE_MATCHING_VERSION`。等过冷却期，或者在原命令后加上 `--config.minimumReleaseAge=0`。

## 开发

仓库自带 flake，提供测试过的 Node 和 Nushell 版本：

```sh
nix develop
```

进入 shell 后，或者本机已有 Node 24 和 Nushell 0.115.1 时：

```sh
npm install
node dev/link-peers.mjs --root <dsh-install-root>
npm run typecheck
npm test
npm run build
```

`dev/link-peers.mjs` 会把 dsh 的 peer 包链接到 `node_modules`，测试因此能直接使用真实的 shell seam，不需要先发布。

测试跑在 Node 24 上。npm 允许安装到 Node 22.19 及以上，但除 24 之外的版本没有测试过。

## 配置

```yaml
- id: nushell-executor
  name: dsh-nu/executor
  config:
    nuPath: ""
    nuArgs: ["--no-config-file", "-c"]
    enforceNushellOnly: true
    dialectLint: true
    dialectHints: true
    requireNu: true
    verifyNu: true
    foreignShellAllowlist: []

- id: nushell-teaching
  name: dsh-nu/teaching
  config:
    guide: full          # full | compact | off
    rules: true
    rewriteToolDescriptions: true
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `nuPath` | `$DSH_NU_PATH`，否则 `nu` | Nushell 可执行文件：先看字段，再看环境变量，最后看 PATH |
| `nuArgs` | `["--no-config-file","-c"]` | argv 前缀；命令追加在最后 |
| `enforceNushellOnly` | `true` | 拒绝把命令交给其他 shell |
| `foreignShellAllowlist` | `[]` | 整条命令正则，豁免 guard 与方言检查 |
| `dialectLint` | `true` | 启动进程前拦下 bash/PowerShell 习惯 |
| `dialectHints` | `true` | 调用失败时追加一行 `Nushell hint (…)` |
| `guide` | `full` | prompt 指南：`full`、`compact`、`off` |
| `rules` | `true` | 在 prompt 前加上 shell 规则段 |
| `rewriteToolDescriptions` | `true` | 改写 `bash` / `pwsh` 工具描述 |
| `requireNu` / `verifyNu` | `true` / `true` | nu 无法解析或 `--version` 探测失败时，启动直接失败 |
| `verifyTimeoutMs` | `10000` | 版本探测的超时时间 |

按目标选 guide：

- `off` 只用于诊断对照：它去掉规则和指南，评测中出现了明显更多的预检拒绝和重试，正常会话不要用。
- `compact` 覆盖常见写法，prompt token 更少；评测里大多数样本没有触发拒绝。
- `full` 保留完整语法参考，覆盖不常见写法和边界情况。

沙箱预算（`cwd`、`timeoutMs` 等）配在 `nushell-executor` 行上，不放进 dsh 共享的 `shell` 设置。要覆盖某一行，在 profile 自己的 `cordis.patch.yml` 里按 id 改。`examples/preset-nu-shell.md` 列出了需要关闭的 preset 级 shell 绕过项。

## “只要 Nushell”覆盖不到的地方

- preset 自己启动 shell 的行，例如直接调用 `ctx.subprocess.spawn` 的插件，或 PTY 常驻 shell 组。严格部署时应关闭，见 `examples/preset-nu-shell.md`。
- 引号参数里的 shell 名称只是数据，不是命令位置。guard 会拦下命令位置和包装链里的交接，但它本身不是沙箱。
- 其他 shell seam 不在 dsh-nu 的范围内：hook 桥、常驻终端和 tmux context 使用各自的服务或脚本。严格部署时应保持关闭。
- dsh-nu 不改沙箱本身：`danger-full-access` 直接运行，受限模式通过 `ctx.sandbox.confine()` 包装 Nushell argv，`mode` / `denied` / `enforcement` 的报告方式保持不变。

## 文档

- [为什么只要 Nushell](why.md)
- [故障排查](troubleshooting.md)
- [验证](verification.md)
- [Nushell 摩擦审查](nushell-friction-review.md)
- [分发与支持（ADR）](../adr/0001-distribution-and-support.md)

## 许可证

MIT，见 [LICENSE](../../LICENSE)。

## 致谢

本项目的 Nushell-only shell、guard 和教学思路来自
[YMRwithNoworry/dsh-nushell-only](https://github.com/YMRwithNoworry/dsh-nushell-only)（MIT），
它是这些思路的原始实现。

感谢 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供 dsh-nu 扩展的 shell seam。

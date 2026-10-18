# dsh-nu

[English](../../README.md) | 中文

一个 DeepSeek Harness 插件包：让 **Nushell 成为编码代理唯一可用的 shell**，并教模型写 Nushell，而不是 bash 或 PowerShell。

每次 shell 调用都是一个独立进程：

```text
nu --no-config-file -c "<command>"
```

这个包注册唯一的 `ctx.shell` provider，把模型看到的 shell 工具描述替换成 Nushell 说明，并在 system prompt 里加上简短规则和语法指南。任何把工作交给其他 shell 的命令都会在创建进程之前被拒绝；bash / PowerShell 习惯会得到带 Nushell 写法的本地错误。

## 状态

预发布。支持 dsh `0.2.1-rc.2` 与 Nushell `0.115.1`，记录在 `package.json` 的 `testedWith`。

## 兼容性

测试组合是 dsh `0.2.1-rc.2` 与 Nushell `0.115.1`。peer 范围固定 dsh 家族；启动时如果安装的 Nushell 或 dsh 与这组不一致，会输出警告。其他版本属于未测试，而不是已知不可用。

## 安装

这个包通过 npm 发布。首次公开 release 之前，请从 release tarball 或本地 checkout 安装。

## 开发

```sh
npm install
node dev/link-peers.mjs --root <dsh-install-root>
npm run typecheck
npm test
npm run build
```

`dev/link-peers.mjs` 把 dsh 的 peer 包链接进 `node_modules`，测试可以直接驱动真实 seam，而不需要发布。

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
| `nuPath` | `$DSH_NU_PATH`，否则 `nu` | Nushell 可执行文件：字段、环境变量、PATH |
| `nuArgs` | `["--no-config-file","-c"]` | argv 前缀；命令追加在最后 |
| `enforceNushellOnly` | `true` | 拒绝把命令交给其他 shell |
| `foreignShellAllowlist` | `[]` | 整条命令正则，豁免 guard 与方言检查 |
| `dialectLint` | `true` | 在启动进程前拒绝 bash/PowerShell 习惯 |
| `dialectHints` | `true` | 失败调用追加一行 `Nushell hint (…)` |
| `guide` | `full` | prompt 指南：`full`、`compact`、`off` |
| `rules` | `true` | 添加 shell 规则段 |
| `rewriteToolDescriptions` | `true` | 改写 `bash` / `pwsh` 工具描述 |
| `requireNu` / `verifyNu` | `true` / `true` | nu 无法解析或 `--version` 探测失败时启动失败 |
| `verifyTimeoutMs` | `10000` | 探测超时 |

沙箱预算（`cwd`、`timeoutMs` 等）配置在 `nushell-executor` 行，而不是 dsh 共享的 `shell` 设置。可在 profile 自己的 `cordis.patch.yml` 中按 id 覆盖。`examples/preset-nu-shell.md` 列出了需要关闭的 preset 级 shell 绕过项。

## “只要 Nushell” 不覆盖的内容

- **自己启动 shell 的 preset 行**：直接调用 `ctx.subprocess.spawn` 的自定义插件，或 PTY 常驻 shell 组。严格部署时应关闭；见 `examples/preset-nu-shell.md`。
- **引号内的交接**：引号参数里的 shell 名称是数据，不是命令位置。guard 会拒绝命令位置和包装链中的交接，但它不是沙箱。
- **其他 shell seam**：hook 桥、常驻终端和 tmux context 使用各自的服务或脚本，不在本 bundle 范围内。严格部署时应保持关闭。
- **沙箱行为不变**：`danger-full-access` 直接运行，受限模式通过 `ctx.sandbox.confine()` 包装 Nushell argv，并保留 `mode` / `denied` / `enforcement` 报告。

## 文档

- [为什么只要 Nushell](why.md)
- [故障排查](troubleshooting.md)
- [验证](verification.md)
- [Nushell 摩擦审查](nushell-friction-review.md)
- [分发与支持（ADR）](../adr/0001-distribution-and-support.md)

## 许可证

MIT，见 [LICENSE](../../LICENSE)。

## 致谢

本项目的 Nushell-only shell、guard 与教学思路来自
[YMRwithNoworry/dsh-nushell-only](https://github.com/YMRwithNoworry/dsh-nushell-only)（MIT），
它是这些思路的原始实现。

感谢 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 项目提供本插件扩展的 shell seam。

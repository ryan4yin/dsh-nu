# 故障排查

[English](../troubleshooting.md) | 中文

## 启动失败：无法解析 nu

当 `requireNu` 为 true 且找不到可执行文件时，执行器会失败关闭。安装 Nushell 并把 `nu` 放进 `PATH`，或在插件配置里设置 `nuPath` / 在环境里设置 `DSH_NU_PATH`。`requireNu: false` 可以照常启动，但所有 shell 调用都会失败，直到可执行文件存在。

## 启动警告：Nushell 版本不同

当 `nu --version` 不是固定版本时，插件会告警。方言规则、hint 和指南都针对固定版本调优，模型被要求写的命令可能与实际版本不一致。请安装固定版本，或接受警告并自行验证行为。

## 被拒绝：外部 shell

错误会给出 shell 名称并引用出问题的语句，例如 `bash -c` 或 `pwsh -Command`，也包括 `env`、`xargs`、`sudo` 这类启动器。请用 Nushell 重写该调用。如果确实必须保留这个调用点，把整条命令的正则加入 `foreignShellAllowlist`，不要为整个部署关闭 guard。

## 被拒绝：bash 或 PowerShell 习惯

拒绝信息会给出片段和对应的 Nushell 写法：编号重定向、`$env:NAME`、裸赋值、`foreach`、PowerShell cmdlet、`&&` / `||`、`$?`，或 Nushell 内置命令上的未知 flag。修正该片段；加上引号会把它变成数据。如果预检对某个调用点判断错误，把该命令加入 allowlist，或设置 `dialectLint: false`。

## 失败信息中带 Nushell hint

hint 行追加在命令自身 stderr 之后，以 `Nushell hint (<id>):` 开头。它针对 Nushell 报出的错误给出一条修复建议；如果命令在启动前就被拒绝，则不会有 hint，因为 Nushell 根本没运行。

## 写入失败：只读或权限不足

这是文件系统或沙箱策略问题，不是 Nushell 语法问题。检查当前会话的沙箱模式，并写入 workspace 或后端允许的临时目录。不要通过另一个工具重试同一次写入。

## 测试找不到 @deepseek-ai 包

dsh 包是 peer 依赖。运行 `npm install`，然后
`node dev/link-peers.mjs --root <dsh-install-root>`。脚本同时接受扁平的 dsh 包 scope 和嵌套在 dsh 包下的 scope，并且不会把 scope 重新链接到自身。

## CI 只在 pull request 上运行

CI 是阶段性验收：一个 pull request 跑一次 Linux、macOS、Windows 矩阵。日常快速循环请本地运行 `npm run typecheck`、`npm test`、`npm run build`；详见 `docs/verification.md`。

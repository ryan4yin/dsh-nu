# 故障排查

[English](../troubleshooting.md) | 中文

## 启动失败：找不到 nu

`requireNu` 为 true 时，执行器找不到可执行文件就会启动失败。安装 Nushell，把 `nu` 放进 `PATH`，或者在插件配置里设置 `nuPath`，也可以在环境里设置 `DSH_NU_PATH`。设成 `requireNu: false` 仍然能启动，但在可执行文件出现之前，每次 shell 调用都会失败。

## 启动警告：Nushell 版本不同

`nu --version` 不是固定版本时，dsh-nu 会输出警告。方言规则、hint 和指南都按固定版本调过，模型被要求写的命令不一定还能照常工作。可以安装固定版本，也可以接受警告并自行检查失败行为。

## 被拒绝：外部 shell

错误信息会给出 shell 名称并引用出问题的语句，例如 `bash -c` 或 `pwsh -Command`，也包括 `env`、`xargs`、`sudo` 这类启动器。请改写成 Nushell。如果这个调用点确实需要例外，把整条命令的正则加进 `foreignShellAllowlist`，不要为整个部署关掉 guard。

## 被拒绝：bash 或 PowerShell 习惯

拒绝信息会指出片段和对应的 Nushell 写法，包括编号重定向、`$env:NAME`、裸赋值、`foreach`、PowerShell cmdlet、`&&` / `||`、`$?`，以及 Nushell 内置命令上的未知 flag。按提示改掉那段写法；给它加引号只会把它变成数据。如果预检对某个调用点判断错了，把那条命令加进 allowlist，或者设置 `dialectLint: false`。

## 失败信息中带 Nushell hint

hint 行跟在命令自身 stderr 后面，以 `Nushell hint (<id>):` 开头，针对 Nushell 报出的错误给一条修复建议。命令在启动前就被拒绝时没有 hint，因为 Nushell 根本没运行。

## 写入失败：只读或权限不足

这是文件系统或沙箱策略的问题，跟 Nushell 语法无关。先看当前会话的沙箱模式，再写入 workspace 或后端允许的临时目录。不要换一个工具重试同一次写入。

## 测试找不到 @deepseek-ai 包

dsh 包是 peer 依赖。先运行 `npm install`，再运行
`node dev/link-peers.mjs --root <dsh-install-root>`。脚本既接受扁平的 dsh 包 scope，也接受嵌套在 dsh 包下的 scope，并且不会把 scope 重新链到自己身上。

## CI 只在 pull request 上运行

CI 是阶段性验收：一个 pull request 跑一次 Linux、macOS、Windows 矩阵。日常开发请本地运行 `npm run typecheck`、`npm test` 和 `npm run build`，详见 `docs/verification.md`。

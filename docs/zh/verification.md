# 验证

[English](../verification.md) | 中文

## 测试套件覆盖什么

`npm test` 覆盖：

- 单元测试：可执行文件解析、argv 组装、外部 shell 扫描、方言规则、教学改写、执行器 seam、启动探测、沙箱包装、继承的预算；
- 差分语料：每条预检拒绝规则都交给固定版本的 Nushell 执行，必须失败，静默重定向除外（它们能运行，另有单独断言）；所有允许的命令必须能运行；
- hint 覆盖：每个 hint id 都有一条真实失败命令；测试用这条命令的 stderr 检查 hint；
- claims 测试：教学指南里可执行的断言都交给固定版本 Nushell 运行；
- manifest 契约：peer 范围、bundle patch、exports 和发布文件列表；
- 文档测试：中英文标题层级一致、固定版本号、相对链接有效、致谢边界正确。

## 本地运行

```sh
npm install
node dev/link-peers.mjs --root <dsh-install-root>
npm run typecheck
npm test
npm run test:integration
npm run build
npm pack --dry-run
```

`nu` 不在 `PATH` 上时，`npm test` 会跳过差分测试，跳过项会显示在输出里。没有固定版本 Nushell，就不算完整验证。

## 差分语料

拒绝列表覆盖编号与 stderr 重定向、shell 风格的 stdout 重定向和写成普通参数的 stderr 重定向、`$env:`、裸赋值和每条命令赋值、`export`、`foreach`、cmdlet、`$_.`、PowerShell `-not` 与 flag 动词、通用参数、`&&` / `||`、命令替换、`$?`、数组字面量、百分号块、负数计数、Nushell 内置命令的未知 flag、逗号分隔列、glob 命名参数、管道后的重定向。改规则必须拿一条固定版本 Nushell 真正拒绝的命令，或一条由单独退出码 0 测试固定的静默误读作证据，不能凭假设。允许列表用来确认预检不会误拒合法的 Nushell、引号内数据、注释和外部工具语法。

## hint 覆盖

每个 hint 模式都对应固定版本 Nushell 实际打印的错误 id，例如 `nu::parser::shell_outerr`、`nu::shell::io::not_found`、`nu::shell::pipeline_mismatch`。测试执行对应命令，把捕获的 stderr 交给 hint 函数。测试不保存捕获的 stderr 文件：每个样本都在运行时由安装的 Nushell 生成，所以不会和实际使用的二进制脱节。有一个样本依赖宿主环境：向 `/sys` 写入时，有些 Linux 返回 EROFS，有些返回 EACCES。测试只在真实出现该错误时断言只读 hint，否则报告跳过。

## 集成探针与真实启动

发布前要针对固定版本 dsh 跑一次探针：在 composition 里挂载执行器和教学层，确认这两行存在，并且平台 shell 执行器行已经禁用。`npm run probe` 用真实 dsh CLI 完成这件事。它构造一个临时 profile，把本包排在 dsh-base 后面，用 `--dump-config` 启动 profile，再检查组合后的插件树。运行需要 dsh 可执行文件（`DSH_INTEGRATION_CLI` 或 PATH 上的 `dsh`）、已链接的 peer 包和构建好的 `dist/`；不会调用模型。

`npm run test:integration` 走得更远。它创建临时 `DSH_HOME`，写入挂载本包的 profile，把一个小探针插件复制进 profile，然后启动真实 dsh。探针通过实时 shell seam 运行 Nushell 内置命令，确认外部 shell 和 bash 重定向在进程创建前就拒绝，检查失败 hint，并检查组装后的 prompt 和工具描述。前置条件和 probe 相同，当前探针还要求 POSIX 主机；CI 在 Linux 上运行。默认启动两次：native 模式检查工具描述，PTC 模式还会检查生成的 `tools:sdk` 声明。传入 `--native` 或 `--ptc` 可以只跑一种模式。

## CI 矩阵

有代码改动的 pull request 会跑 Ubuntu、macOS、Windows 矩阵，并安装固定版本 Nushell。CI 是阶段性验收，不是日常快速循环：开发时在本地跑上面的命令，让一个 PR 统一验证平台矩阵。纯文档 PR 只跑 Docs workflow。

## 已知限制

- 固定支持组合是 dsh `0.2.1-rc.2` 与 Nushell `0.115.1`。
- 预检是启发式扫描器，不是解析器。字符串或注释里的习惯，预检会当作数据放行；特殊构造仍可能需要 allowlist。
- hint 只在 Nushell 报错后出现；启动前被拒绝的命令没有 hint。
- CI 的 Windows 上没有权限类差分 hint 样本，该样本在 Windows 上跳过。

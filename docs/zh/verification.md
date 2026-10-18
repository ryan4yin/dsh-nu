# 验证

[English](../verification.md) | 中文

## 测试套件覆盖什么

`npm test` 包含四类测试：

- 单元测试：可执行文件解析、argv 组装、外部 shell 扫描、方言规则、教学层改写、执行器 seam；
- 差分语料：每条预检拒绝规则都用固定版本的真实 Nushell 执行，必须失败；每条允许的命令必须成功；
- hint 覆盖：每个 hint id 都有一条真实失败命令，测试用这条命令实际的 stderr 断言 hint；
- 文档测试：中英文标题层级一致、固定版本号、相对链接、致谢边界。

## 本地运行

```sh
npm install
node dev/link-peers.mjs --root <dsh-install-root>
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

当 `nu` 不在 `PATH` 上时，`npm test` 会跳过差分测试；跳过项会在输出里显示。没有固定版本 Nushell 的机器上的运行不算完整验证。

## 差分语料

拒绝列表覆盖编号重定向、`$env:`、裸赋值、`foreach`、cmdlet、`&&` / `||`、命令替换、`$?`、Nushell 内置命令的未知 flag、逗号分隔列。修改规则必须给出一条固定版本 Nushell 真正拒绝的命令，不能只靠假设。允许列表证明预检不会误拒合法的 Nushell 或外部工具语法。

## hint 覆盖

每个 hint 模式都对应固定版本 Nushell 实际打印的错误 id，例如 `nu::parser::shell_outerr`、`nu::shell::io::not_found`、`nu::shell::pipeline_mismatch`。测试执行对应命令，把捕获的 stderr 交给 hint 函数。有一个样本依赖宿主环境：向 `/sys` 写入时，有些 Linux 返回 EROFS，有些返回 EACCES；因此只有在真实出现只读错误时才断言对应 hint，跳过时会说明。

## 集成探针与真实启动

发布门槛要求针对固定版本 dsh 的探针：在 composition 中挂载执行器和教学层，确认执行器与教学层行存在、平台 shell 执行器行已禁用。`npm run probe` 会用真实 dsh CLI 做这件事：构造一个临时 profile，在 dsh-base 之后命名本包，用 `--dump-config` 启动并检查组合后的插件树。它需要 dsh 可执行文件（`DSH_INTEGRATION_CLI` 或 PATH 上的 `dsh`）、已链接的 peer 包，以及构建好的 `dist/`。它不会调用模型。

`npm run test:integration` 更进一步：创建临时 `DSH_HOME`，写一个挂载本包的 profile，把一个小探针插件复制进 profile，然后真实启动 dsh。探针通过实时 shell seam 运行 Nushell 内置命令，确认外部 shell 和 bash 重定向在创建进程前被拒绝，检查失败 hint，并检查组装后的 prompt 与工具描述。它需要与 probe 相同的前置条件，当前探针要求 POSIX 主机；CI 在 Linux 上运行它。默认启动两次：native 模式检查工具描述，PTC 模式还会检查生成的 `tools:sdk` 声明。传入 `--native` 或 `--ptc` 可只跑一个模式。

## CI 矩阵

CI 在 pull request 上运行 Ubuntu、macOS、Windows 矩阵，并安装固定版本 Nushell。它是阶段性验收，不是快速循环：开发时本地跑上面的命令，让一个 PR 统一验证平台矩阵。

## 已知限制

- 固定支持组合是 dsh `0.2.1-rc.2` 与 Nushell `0.115.1`。
- 预检是启发式扫描器，不是解析器。字符串或注释里的习惯会被当作数据放行；特殊构造仍可能需要 allowlist。
- hint 只在 Nushell 报错后出现；启动前被拒绝的命令没有 hint。
- CI 的 Windows 没有权限类差分 hint 样本，该样本在 Windows 上跳过。

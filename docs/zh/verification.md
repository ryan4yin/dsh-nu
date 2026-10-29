# 验证

[English](../verification.md) | 中文

## 测试套件覆盖什么

`npm test` 覆盖：

- 单元测试：可执行文件解析、argv 组装、guard、语法规则、教学改写、执行器 seam、启动探测、沙箱包装、继承的预算；
- 解析器契约测试。预检依赖 `nu --ide-ast` 与 `nu --ide-check` 的精确输出：包含 shape、content、span 的扁平 token 列表，以及 JSONL 诊断。契约测试固定预检读取的 shape、offset 和字段；Nushell 的 IDE 输出变化会让测试失败，而不是悄悄放松 guard；
- 差分语料。每条拒绝的语法形式都交给固定版本的 Nushell 执行，必须失败；Nushell 静默接受的写法另有测试：实际运行、断言退出码 0 的真实行为。所有允许的写法必须能运行。交接用例断言 guard 的结论，覆盖嵌套 block、closure、插值、包装链，以及只是数据的 shell 名称；
- 仅限 Linux 的 PATH-shim fuzz 测试。预检放行的命令会在真实 Nushell 里执行，同时把外部 shell 的替身可执行文件放在 `PATH` 最前面；替身一旦被调用，测试就失败；
- hint 覆盖。每个 hint id 都有真实 Nushell 诊断，包括成功退出时的弃用警告。恢复测试执行建议的新写法，并检查输出和退出状态；通用诊断 ID 还配有不应匹配的反例；
- claims 测试。教学指南里可执行的断言都交给固定版本 Nushell 运行；
- manifest 契约：peer 范围、bundle patch、exports 和发布文件列表；
- 文档测试：文档集合存在、没有序列化占位符、重复的固定版本号、README 里的 bundle 行 id、相对 Markdown 链接有效。

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

`npm test` 需要 `PATH` 上有固定版本 Nushell。差分和 hint 测试在找不到时会报告跳过，预检测试则会失败；没有固定版本 Nushell，就不算完整验证。

## 解析器探针与差分语料

预检直接读取 Nushell 自己的解析结果，不再维护第二套词法分析器；原因见 [ADR 0004](../adr/0004-ast-based-preflight.md)。测试固定两端：

- token 与诊断契约，保证预检在每个支持的平台上都能读到预期的字段；
- 命令语料，交给固定版本的二进制执行。改规则必须拿一条固定版本 Nushell 真正拒绝的命令，或一条由单独退出码 0 测试固定的静默误读作证据，不能凭假设。

编号 stderr 重定向属于第二类：Nushell 把它当作普通参数接受，退出码 0，什么也不重定向。测试会运行它、断言这种静默行为，再断言预检拒绝它。

## 探针无法运行时

任一探针失败、超时或返回意料之外的形状时，预检无法运行。`verifyNu` 开启且至少一项检查启用时，启动会跑一次 token 与 diagnostic 金丝雀：`^true` 必须暴露 `shape_external` token，`echo hi 2>&1` 必须映射为 `stderr-redirect`。默认的 `requireNu` 下金丝雀失败会让启动直接失败；设成 `requireNu: false` 时，每次调用都会在进程启动前被拒绝。错误信息说明 AST 预检无法运行，并给出 `enforceNushellOnly: false`、`syntaxLint: false` 两个开关，以及固定 Nushell 版本。未经检查就运行会丢掉 only-Nushell 保证，因此执行器选择 fail closed。测试覆盖了这条路径：解析拒绝并抛出 preflight 错误，语法检查也会拒绝该命令。

## PATH-shim fuzz

测试套件里有一个仅限 Linux 的 PATH-shim fuzz 测试：写入外部 shell 的替身可执行文件，把它们放在 `PATH` 最前面，然后运行预检放行的命令形状；只要替身记录到一次调用，就说明预检漏掉了交接。语料由固定种子生成，失败可以复现。替身是 POSIX 脚本，因此该测试在 macOS 和 Windows 上跳过；Linux 矩阵任务会随 `npm test` 运行它。

## 集成探针与真实启动

发布前要针对固定版本 dsh 跑一次探针：`npm run probe` 在真实 composition 里挂载执行器和教学层，确认这两行存在，并且平台 shell 执行器行已经禁用。它构造临时 profile，用 `--dump-config` 启动并检查组合后的插件树，不调用模型。

`npm run test:integration` 走得更远：创建临时 `DSH_HOME`，写入挂载本包的 profile，把一个小探针插件复制进去，然后启动真实 dsh。探针通过实时 shell seam 运行 Nushell 内置命令，确认外部 shell 和 bash 重定向在进程创建前就拒绝，检查失败 hint，并检查组装后的 prompt 和工具描述。默认启动两次：native 模式检查工具描述，PTC 模式还会检查生成的 `tools:sdk` 声明；传入 `--native` 或 `--ptc` 可以只跑一种模式。两个命令都需要已链接的 peer 包、构建好的 `dist/` 和 dsh 可执行文件；集成启动还需要 POSIX 主机，并在 Linux CI 上运行。

## CI 矩阵

有代码改动的 pull request 会跑 Ubuntu、macOS、Windows 矩阵，并安装固定版本 Nushell。`npm test` 会执行两个 IDE 探针，因此三个平台都会验证预检。Linux 任务还会跑集成启动。纯文档 PR 只跑 Docs workflow。CI 是阶段性验收，不是日常快速循环：开发时在本地跑上面的命令，让一个 PR 统一验证平台矩阵。

## 手动验证

- 组合配置探针（`npm run probe`）手动运行；Linux CI 会跑集成启动。
- 真实模型的教学评测是手动的，不进 PR CI：三个 arm、每个用例每个 arm 三次采样、跨模型 judging、带日期的报告。见 [`eval/README.md`](../../eval/README.md)。
- 依赖宿主环境的 hint 样本只在真实出现该错误时断言，否则报告可见的跳过。
- 中英文标题层级一致和致谢边界属于评审规则，不是测试。文档测试不再强制这两项。

## 已知限制

- 固定支持组合是 dsh `0.2.2-alpha.2` 与 Nushell `0.116.1`。
- guard 不是沙箱。它跟踪字面量 shell 名称、固定的 launcher 表、`run-external`，以及最多四层的字面量 `nu -c` / `nu -e` 脚本。运行时才确定的 shell 名称、自己会启动 shell 的程序、藏在数据里的 shell 名称，以及 `nu <file>`、`source`、`use` 加载的脚本文件都在覆盖范围外。普通引号字符串是数据；`$"…"` / `$'…'` 插值会作为代码检查。
- hint 解释已识别的 Nushell 错误和弃用警告，成功退出的弃用警告也会得到提示；实际错误优先于警告。普通退出码 0 的 stderr、超时、取消和沙箱拒绝不追加 hint。预检拒绝使用自己的修复说明。
- [会话扫描器](../../dev/session-scan.md) 汇总明确指定的本地事件文件，区分退出状态未知和失败，不推断修复或任务成功率。
- 预检 fail closed，因此 Nushell 的 IDE 输出与测试形状不符时，调用会被拒绝，直到版本对齐。
- CI 的 Windows 上没有权限类差分 hint 样本，该样本在 Windows 上跳过。

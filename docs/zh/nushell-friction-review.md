# Nushell 摩擦审查

真实 Nushell 0.115.1 的输出和构建过程中遇到的失败改变了什么，以及当前仍存在的已知缺口。这份审查是 0.1.0 门槛的一部分：下面每一条都来自实际运行过的命令，而不是对 Nushell 行为的猜测。

## 构建过程中遇到的拒绝

构建本项目的 agent 自己写的命令被 guard 和方言预检拒绝过。每次拒绝都用真实 shell 验证：

- `2>/dev/null` 和 `2>nul` 不是重定向。Nushell 把它们当普通参数接受，退出码 0，实际什么都没做；预检会拒绝，避免这种静默无效被当成成功。带真实目标的 `2> file` 才是 `nu::parser::shell_err`。
- `2>&1` 是 `nu::parser::shell_outerr`（Nushell 写作 `o+e>`），被拒绝。
- `mkdir -p` 和 `ls -R` 报 `nu::shell::unknown_flag`；Nushell 自动创建父目录，递归用 glob。拒绝并给出替代写法。
- `$?` 不是变量，Nushell 报 `Incomplete variable`。guard 指向 `(do { cmd } | complete).exit_code`。
- `Start-Sleep` 是 PowerShell cmdlet，不是 Nushell 命令。cmdlet 规则命中并指向 `sleep 2sec`。

## 不是语法错误的 Nushell 语义

这些情况扫描器不能靠"改写"处理；它们是真实行为，应写进指南和 hint：

- `print "x" | str length` 报 `nu::parser::input_type_mismatch`，因为 `print` 写入 stdout 但不返回值，下一段拿不到输入。friction corpus 现在用 `"x" | str length`，教学层也明确要求把 `print` 放在最后或让最终值直接输出。
- Nushell 里 `>` 是比较。看起来像 shell 的 `cmd > file` 什么都不写；所以指南明确写 `o>`、`e>`、`o+e>`。
- 必须先 `mut x = 1` 才能 `$x = 2`；裸赋值规则会跳过用 `mut` 声明的变量。
- 向 `/sys` 写入时，有些 Linux 报 `nu::shell::io::read-only_filesystem_or_storage_medium`，有些报 `permission_denied`。hint 测试只在真实出现 EROFS 时断言只读 hint，跳过时会说明。

## 改了什么

- guard 的外部 shell、启动器、引号、注释和 allowlist 都有单元测试和差分语料覆盖。
- 方言规则以真实 `nu` 的拒绝列表为依据：只有固定版本 Nushell 真正拒绝的片段才会新增规则。
- 每个 hint 模式都对应 `test/dialect.test.ts` 里一条真实失败命令。
- friction corpus（`test/friction.test.ts`）让 30 条真实 agent 命令先过预检，再交给真实 shell 执行。
- `test/dialect.test.ts` 通过实际运行来拒绝/接受命令，规则对 Nushell 判断错误时测试会失败。

## 已知缺口

- 预检是启发式扫描器，不是解析器。字符串、注释或原始字符串里的习惯会被当作数据放行；特殊构造可能需要 allowlist。
- hint 只在 Nushell 报错后出现；启动前被拒绝的命令没有 hint。
- Windows CI 没有权限类差分 hint 样本；该样本在 Windows 上跳过。
- 语料覆盖常见 agent 命令，不是全部 Nushell 功能。语料之外被 guard 误拒的命令应加入语料。
- Nushell 里裸 `>` 是比较，`cmd > file` 会退出 0 但什么都不写。没有预检规则拦截它：同一个符号也是合法比较，启发式规则会误拒正常代码。指南会警告，这仍是已记录的局限。

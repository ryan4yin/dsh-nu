# Nushell 摩擦审查

真实 Nushell 0.115.1 的表现，以及构建这个项目时踩到的失败，改变了哪些设计；还有哪些已知缺口。下面每一条都对应一条实际运行过的命令。

## 构建时被拒绝的命令

构建本项目的 agent 写过一些命令，被 guard 和方言预检挡了下来。每次拒绝都拿真实 shell 验证过：

- `2>/dev/null` 和 `2>nul` 不是重定向。Nushell 把它们当普通参数收下，退出码 0，实际什么都没做；预检拒绝这种写法，免得静默无效被模型当成成功。带真实目标的 `2> file` 才是 `nu::parser::shell_err`。
- `2>&1` 会报 `nu::parser::shell_outerr`（Nushell 写作 `o+e>`），所以被拒绝。
- `mkdir -p` 和 `ls -R` 报 `nu::shell::unknown_flag`。Nushell 会自动创建父目录，递归用 glob 代替；拒绝信息里给出了替代写法。
- `$?` 不是变量，Nushell 报 `Incomplete variable`，guard 指向 `(do { cmd } | complete).exit_code`。
- `Start-Sleep` 是 PowerShell cmdlet，不是 Nushell 命令。cmdlet 规则命中后指向 `sleep 2sec`。

## 不是语法错误的 Nushell 行为

这些不能靠改写命令来修。它们是 Nushell 的真实行为，所以交给指南和 hint 解释：

- `print "x" | str length` 报 `nu::parser::input_type_mismatch`。`print` 只写 stdout，不返回值，下一段拿不到输入。friction corpus 改用 `"x" | str length`，教学层也要求把 `print` 放在最后，或者直接让最终值输出。
- Nushell 里 `>` 是比较。看起来像 shell 的 `cmd > file` 什么都不写，还返回 0；所以指南专门写清 `o>`、`e>`、`o+e>`。
- 要先 `mut x = 1` 才能写 `$x = 2`。裸赋值规则会跳过用 `mut` 声明过的变量。
- 往 `/sys` 写入时，有些 Linux 报 `nu::shell::io::read-only_filesystem_or_storage_medium`，有些报 `permission_denied`。hint 测试只在真的出现 EROFS 时断言只读 hint，否则报告跳过。

## 改了什么

- guard 的外部 shell、启动器、引号、注释和 allowlist 都有单元测试和差分语料覆盖。
- 新增方言规则的前提，是固定版本 Nushell 真的拒绝那条片段；规则跟着二进制走。
- 每个 hint 模式都在 `test/dialect.test.ts` 里有一条对应的真实失败命令。
- `test/friction.test.ts` 让 30 条常见的 agent 命令先过预检，再交给真实 shell 执行。
- `test/dialect.test.ts` 通过实际运行来判断接受还是拒绝，规则一旦判断错，测试就会失败。

## 已知缺口

- 预检是启发式扫描器，不是解析器。字符串、注释或原始字符串里的习惯会被当作数据放行；特殊构造可能需要 allowlist。
- hint 只在 Nushell 报错后出现；启动前就被拒绝的命令没有 hint。
- Windows CI 上没有权限类差分 hint 样本，这个样本会跳过。
- 语料覆盖的是常见 agent 命令，不是 Nushell 的全部功能。语料之外被 guard 误拒的命令，应该补成语料。
- Nushell 里裸 `>` 是比较，`cmd > file` 会返回 0 但什么都不写。没有预检规则能拦它：同一个符号也是合法比较，启发式规则会误伤正常代码。指南会提醒这一点，这仍然是一个记录在案的局限。

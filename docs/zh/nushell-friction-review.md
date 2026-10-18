# Nushell 摩擦审查

这一页记录 Nushell 0.115.1 的实际表现、构建时踩到的失败、由此改掉的设计和仍然存在的缺口。下面每一条都对应一条实际运行过的命令。

## 构建时被拒绝的命令

构建本项目的 agent 写过一些命令，guard 和非 Nushell 语法拦截把它们挡了下来。每次拒绝都拿真实 shell 验证过：

- `2>/dev/null`、`2>nul` 和 `2>> file` 不是重定向。Nushell 把它们当普通参数收下，退出码 0，实际什么都没做；`stderr-as-word` 预检规则会拒绝这种写法，免得静默无效让模型误以为成功。带空格和真实目标的 `2> file` 才是 `nu::parser::shell_err`，由 `stderr-file` 拒绝。
- `2>&1` 会报 `nu::parser::shell_outerr`（Nushell 写作 `o+e>`），预检直接拒绝。
- `mkdir -p` 和 `ls -R` 报 `nu::shell::unknown_flag`。Nushell 会自动创建父目录，递归用 glob 代替；拒绝信息里给出了替代写法。
- `$?` 不是变量，Nushell 报 `Incomplete variable`，非 Nushell 语法拦截指向 `(do { cmd } | complete).exit_code`。
- `Start-Sleep` 是 PowerShell cmdlet，不是 Nushell 命令。cmdlet 规则命中后指向 `sleep 2sec`。

## 不是语法错误的 Nushell 行为

这些不能靠改写命令来修。它们是 Nushell 的真实行为，所以交给指南和 hint 解释：

- `print "x" | str length` 报 `nu::parser::input_type_mismatch`。`print` 只写 stdout，不返回值，下一段拿不到输入。friction corpus 改用 `"x" | str length`，教学层也要求把 `print` 放在最后，或者直接让最终值输出。
- Nushell 里 `>` 是比较。看起来像 shell 的 `cmd > file` 什么都不写，还返回 0；所以指南专门写清 `o>`、`e>`、`o+e>`，而 `stdout-redirect` 规则会在目标看起来像路径时拒绝这种写法。
- 要先 `mut x = 1` 才能写 `$x = 2`。裸赋值规则会跳过用 `mut` 声明过的变量。
- 往 `/sys` 写入时，有些 Linux 报 `nu::shell::io::read-only_filesystem_or_storage_medium`，有些报 `permission_denied`。hint 测试只在真的出现 EROFS 时断言只读 hint，否则报告跳过。

## 改了什么

- guard 的外部 shell、启动器、引号、注释和 allowlist 都有单元测试和差分语料覆盖。
- 新增非 Nushell 语法拦截规则的前提，是固定版本 Nushell 真的拒绝或静默误读那条片段；静默的一类单独断言，因为退出码 0 证明不了什么。
- 每个 hint 模式都在 `test/syntax.test.ts` 里有一条对应的真实失败命令。
- `test/friction.test.ts` 让 30 条常见的 agent 命令先过预检，再交给真实 shell 执行。
- `test/syntax.test.ts` 通过实际运行来判断接受还是拒绝，包括退出码 0 但什么都没写的静默重定向，规则一旦判断错，测试就会失败。

## 已知缺口

- 预检是启发式扫描器，不是解析器。字符串、注释或原始字符串里的语法写法，预检会当作数据放行；特殊构造仍可能需要 allowlist。
- hint 只在 Nushell 报错后出现；启动前就被拒绝的命令没有 hint。
- Windows CI 上没有权限类差分 hint 样本，这个样本会跳过。
- 语料覆盖的是常见 agent 命令，不是 Nushell 的全部功能。语料之外若被 guard 误拒，应该补一条语料。
- `stdout-redirect` 的目标判断是启发式：目标带路径特征（扩展名、斜杠、冒号或 `nul`）才拒绝，所以 `cmd > out.txt` 和 `cmd > /dev/null` 会被拦下，而 `where size > 1kb`、`if $n > 2` 照常可用。没有路径特征的目标（`cmd > out`）和比较无法区分，仍只靠指南提醒。

# Nushell 摩擦审查

这一页记录 Nushell 0.115.1 的实际表现、构建时踩到的失败、由此改掉的设计和仍然存在的缺口。下面每一条都对应一条实际运行过的命令。

## 构建时被拒绝的命令

构建本项目的 agent 写过一些命令，guard 和语法规则把它们挡了下来。每次拒绝都拿真实 shell 验证过：

- `2>/dev/null`、`2>nul` 和 `2>> file` 不是重定向。Nushell 把它们当普通参数收下，退出码 0，实际什么都没做；`stderr-as-word` 语法规则会拒绝这种写法，免得静默无效让模型误以为成功。带空格和真实目标的 `2> file` 才是 `nu::parser::shell_err`，由 `stderr-file` 拒绝。
- `2>&1` 会报 `nu::parser::shell_outerr`（Nushell 写作 `o+e>`），预检直接拒绝。
- `mkdir -p` 和 `ls -R` 报 `nu::shell::unknown_flag`。Nushell 会自动创建父目录，递归用 glob 代替；拒绝信息里给出了替代写法。
- `$?` 不是变量，Nushell 报 `Incomplete variable`，语法规则指向 `(do { cmd } | complete).exit_code`。
- `Start-Sleep` 是 PowerShell cmdlet，不是 Nushell 命令。cmdlet 规则命中后指向 `sleep 2sec`。

## 不是语法错误的 Nushell 行为

这些不能靠改写命令来修。它们是 Nushell 的真实行为，所以交给指南和 hint 解释：

- `print "x" | str length` 报 `nu::parser::input_type_mismatch`。`print` 只写 stdout，不返回值，下一段拿不到输入。friction corpus 改用 `"x" | str length`，教学层也要求把 `print` 放在最后，或者直接让最终值输出。
- Nushell 里 `>` 是比较。看起来像 shell 的 `cmd > file` 什么都不写，还返回 0；所以指南专门写清 `o>`、`e>`、`o+e>`，而 `stdout-redirect` 规则会拒绝参数位置上的裸 `>`/`<`，不再看目标长什么样；比较在解析结果里是 operator，`where size > 1kb`、`if 3 > 2` 仍然有效。
- 要先 `mut x = 1` 才能写 `$x = 2`。裸的 `$x = 2` 会被当作 `bare-assignment` 拒绝；如果先用 `let` 声明，则交给 Nushell 自己的 `immutable-assignment` hint 解释改法，预检不再拦它。
- 往 `/sys` 写入时，有些 Linux 报 `nu::shell::io::read-only_filesystem_or_storage_medium`，有些报 `permission_denied`。hint 测试只在真的出现 EROFS 时断言只读 hint，否则报告跳过。

## 复查

之后又对 guard、预检和执行器做了一轮复查。每条发现都先用固定版本 Nushell 复现，再动手修：

- `FOO=1 ^printenv FOO` 输出 `1`，说明每条命令的环境前缀是合法的 Nushell。旧的 `prefix-assignment` 规则会误拒它；规则已删除，允许语料固定了这条能跑通的命令。
- `print a#b; bash -c 'echo H'` 会真的启动 bash：`#` 只在 token 边界才开始注释。解析器把 `a#b` 当作一个普通单词，词中间的 `#` 不再掩护 shell 交接。
- `print $"a(bash -c 'echo I')b"` 输出 `aIb`。`$"…"` 和 `$'…'` 会插值，所以解析器会把每个括号片段作为代码暴露出来；普通引号文本仍是数据。
- `do { /bin/sh -c … }`、`do { env bash … }`、`do { FOO=1 bash … }` 和 `let x = (env bash …)` 都会启动外部 shell，而旧 guard 只看块的开头。现在 guard 覆盖每个命令位置：块、子表达式、分隔符、管道、带路径的程序、环境前缀和启动器。
- 多行 record、list、closure、`match "bash" { bash => 1 }`、`{ sh : 1 }` 和 `|sh, ...rest|` 曾被 guard 误拒。现在由解析器判断语句边界，record key、match arm 和 closure 参数不再当作命令位置。
- Windows 上所有受限调用都会失败：父类把 `ShellExecSpec` 传给 `confine`，旧实现却从字符串上读 `.command`。现在两种形态都接受。
- hint 曾追加到退出码 0 的调用和沙箱拒绝上，垃圾 `nu --version` 输出也能启动。现在 hint 要求非零退出码且非拒绝，版本探测必须解析出版本号。
- 生成的 PTC `tools:sdk` 文本残留宿主声明（`${VAR:?}`、`$env:`、大小写不敏感变量、pwsh 沙箱模式），改写规则现在会清掉。

## 改了什么

- guard 的外部 shell 名称、启动器表、包装链、嵌套与插值里的交接和 allowlist，都有单元测试和仅限 Linux 的 PATH-shim fuzz 测试覆盖。
- 新增语法规则的前提，是固定版本 Nushell 真的拒绝或静默误读那条片段；静默的一类单独断言，因为退出码 0 证明不了什么。
- 每个 hint 模式都在 `test/syntax.test.ts` 里有一条对应的真实失败命令。
- `test/friction.test.ts` 让一组常见的 agent 命令先过预检，再交给真实 shell 执行。
- `test/syntax.test.ts` 通过实际运行来判断接受还是拒绝，包括退出码 0 但什么都没写的静默重定向，规则一旦判断错，测试就会失败。

## 已知缺口

- guard 不是沙箱。普通字符串、注释或原始字符串里的语法写法会当作数据放行；`$"…"` / `$'…'` 插值是代码，会继续检查。运行时才确定的 shell 名称、自己会启动 shell 的程序、只作为数据存在的 shell 名称，以及 `nu <file>`、`source`、`use` 加载的脚本文件都在覆盖范围外。allowlist 仍用于确实需要外部 shell 的命令。
- hint 只在调用失败时出现；退出码 0 和沙箱拒绝都没有 hint，启动前被拒绝的命令也没有 hint。
- Windows CI 上没有权限类差分 hint 样本，这个样本会跳过。
- 语料覆盖的是常见 agent 命令，不是 Nushell 的全部功能。语料之外若被 guard 误拒，应该补一条语料。
- `stdout-redirect` / `stdin-redirect` 现在按 token 判断：比较在解析结果里是 operator，所以参数位置上以 `>` 或 `<` 开头的词一律拒绝，包括没有路径特征的 `cmd > out`。`where size > 1kb`、`if $n > 2` 和日期时间比较仍然是 operator，照常可用。

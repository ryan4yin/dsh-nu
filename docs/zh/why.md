# 为什么只要 Nushell

[English](../why.md) | 中文

shell 不只是命令执行器。它是一个带隐藏状态的文本协议，编码代理会为协议里的每个尖角付出浪费的回合。这个插件包存在，是因为“直接用 bash”一直在制造同一类失败。

## 混合 shell 是一种失败模式

明显的代价是语法不对：flag 属于另一个 shell、重定向其实是比较、环境变量前缀错误。更贵的代价更安静：

- **该用数据的地方用了文本。** `ps aux | grep server` 经常把 `grep` 进程本身也匹配进来；`cmd | grep pattern` 报的是 `grep` 的状态，所以命令失败时也可能看起来成功。
- **用固定 sleep 猜完成。** 一个 3 秒的任务，代理写 `sleep 90` 来等；另一个写 `sleep 120` 或 `sleep 400` 等一个 5 秒就起来的服务。数字是猜的：要么长了 30 倍，要么不够，再叠加重试循环。sleep 不是同步原语。
- **隐藏状态和静默成功。** `cd` 会保留，变量替换后还会做分词和通配符展开，引号规则因 shell 而异，管道状态取最后一个阶段。命令“成功”了，但它报告的工作可能失败了。
- **会移动的方言。** 模型在一个工具里看到 bash，在另一个里看到 PowerShell，在文档里看到第三种。它复制最近见过的，解析失败后学会换方言，而不是修命令。

这就是为什么 harness 规则迭代了很多轮：多步工作优先用 PTC，shell 工作用 Nushell，一般本地处理用 Python，绝不把命令字符串交给另一个 shell，也绝不把完成等待变成固定延迟。

## Nushell 改变了什么

Nushell 给模型一套执行模型，而不是一整个方言家族：

- 管道传递结构化值，不是格式化文本；`ls | where size > 1mb` 过滤数据，`open --raw file | lines | where { |l| $l =~ "x" }` 过滤行；
- 只有一种重定向和一种变量写法，替换后不做分词或路径展开；
- 有类型的 duration（`sleep 2sec`），错误显式，而不是静默退出码；
- 每次调用一个进程，`cd` 和 shell 变量不会跨调用泄漏；工具调用的 `workdir` 才是工作目录契约。

Nushell 是更好的 shell。但它仍然是 shell，不是调度器。

## 这个插件包增加了什么

- **唯一执行器**：每次 shell 调用都变成 `nu --no-config-file -c "<command>"`，harness 不会为模型启动 bash 或 PowerShell。
- **Guard**：任何把工作交给其他 shell 的命令都会在创建进程前被拒绝，并引用出问题的语句。
- **方言预检**：在 Nushell 中会失败的 bash / PowerShell 习惯会被拒绝，并给出对应的 Nushell 写法。
- **Hint**：Nushell 真实报出的失败会追加一行可操作的修复提示。
- **教学层**：shell 工具描述、PTC SDK 文本和 prompt 中的简短规则都按 Nushell 描述，模型不会从工具 schema 里学到旧方言。

规则和 hint 都针对固定版本 Nushell 的真实行为测试过，不是对 Nushell 行为的猜测。

## Nushell 解决不了什么

换 shell 解决不了代理的调度问题。插件包可以拒绝 `bash -c`、教 Nushell 语法，但它无法判断命令是否完成，也不应该把 `sleep 90` 当成完成信号。这些仍然要靠 harness 规则：

- 等待工作自己的完成：runtime 的 job wait、`kubectl wait --timeout`，或进程退出；不要在检查前先 sleep；
- 任何轮询都必须检查条件，并在条件成立时立即退出；
- 重试和退避要有总时限，重试间隔以秒计，不能变成进度等待；
- 过滤输出时保留生产者的退出状态（Nushell 用 `| complete`）；
- 服务和 watcher 用后台 job 启动并保留 handle，不要用 `&` 加 `ps | grep`。

这些是进程管理和模型行为规则，不是语法。shell 插件包负责方言边界，harness 规则负责等待和状态纪律。

## 什么情况下不适合

- 你需要这个项目没有实现的 shell（例如只提供 bash 入口的运行时）。allowlist 和 `enforceNushellOnly: false` 可用于这种情况，但会放弃这个插件包要提供的保证。
- 你使用的 dsh 或 Nushell 不是受支持的固定组合。插件会带警告启动，但方言规则和 hint 只针对固定版本调优。
- 你需要模型侧 shell 工具提供 Windows PowerShell 语义。Windows 上工具名仍是 `pwsh`，但背后的程序是 Nushell。

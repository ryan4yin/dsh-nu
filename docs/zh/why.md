# 为什么只要 Nushell

[English](../why.md) | 中文

agent 在 shell 上出的问题，很多来自 shell 本身，命令写错只是其中一小部分。命令输出一段文本，下一步还得重新解析；后台进程没有 handle，agent 只能先 `sleep` 一段时间再猜；每个工具给的 shell 语法还不一样，模型就照着最近看到的那种写。

dsh-nu 是跟着 harness 规则一起长出来的。这些规则前后改了好几轮：多步工作交给 PTC，shell 工作用 Nushell，一般本地处理用 Python，命令字符串不交给另一个 shell，也不把完成等待变成固定延迟。

## 混合 shell 的代价

语法冲突是最容易看见的：flag 属于别的 shell，重定向在 Nushell 里其实是比较，环境变量的前缀不对。更麻烦的是那些不报错的问题：

- `ps aux | grep server` 经常把 `grep` 自己也算进去；`cmd | grep pattern` 报的是 `grep` 的退出状态，命令明明失败了，只要 `grep` 没匹配到或匹配到一段错误文本，就可能看起来成功。
- 一个 3 秒就能结束的任务，agent 可能写 `sleep 90`；一个 5 秒就起来的服务，可能等 `sleep 120` 或 `sleep 400`。数字全靠猜，不是太长就是不够，再套一层重试，浪费的时间会成倍增加。
- `cd` 会一直生效，变量展开后还会分词和做通配符匹配，引号规则在不同 shell 里也不一样。管道最终报的是最后一段命令的状态，前面的命令失败了也可能显示成功。
- 模型在一个工具里看到 bash，在另一个工具里看到 PowerShell，在文档里又看到第三种。它照着最近看到的那份写，解析失败后换一套 shell 语法再试，很少回头检查命令本身。

## Nushell 改了什么

Nushell 给模型一套统一的执行模型，不再是几套 shell 语法。管道传的是结构化数据，`ls | where size > 1mb` 直接过滤数据，`open --raw file | lines | where { |l| $l =~ "x" }` 直接过滤行。重定向和变量各只有一种写法，替换之后不会再做分词或路径展开。时长有类型，`sleep 2sec` 一眼能看出单位；出错时会报错，不会只留一个沉默的退出码。每次调用都是一个独立进程，`cd` 和 shell 变量不会带到下一次调用；工作目录由工具参数 `workdir` 决定。

Nushell 是更好的 shell，但它仍然只是 shell，不负责调度。

## dsh-nu 做了什么

- 每次 shell 调用都变成 `nu --no-config-file -c "<command>"`，harness 不会为模型启动 bash 或 PowerShell。
- 命令如果把工作交给其他 shell，预检会在进程启动前拒绝它，并引用出问题的语句。
- 非 Nushell 语法拦截也会拦下在 Nushell 里跑不通的 bash、PowerShell 语法，并给出对应的 Nushell 写法。
- Nushell 真实报错后，会追加一行说明怎么改。
- shell 工具描述、PTC SDK 文本和 prompt 里的一小段规则都按 Nushell 写，工具 schema 也就不会继续把旧 shell 语法教给模型。

规则和 hint 都拿固定版本的 Nushell 实际验证过。

## Nushell 解决不了什么

换 shell 解决不了 agent 的调度问题。dsh-nu 能拒绝 `bash -c`，能教 Nushell 语法，但它不知道一条命令什么时候算完成，也不该把 `sleep 90` 当成完成信号。这部分仍然由 harness 规则负责：

- 等任务自己结束：runtime 的 job wait、`kubectl wait --timeout`，或者进程退出；
- 需要轮询时，每次都要检查条件，条件成立就退出；
- 重试和退避要有总时限，重试间隔以秒计，不要拿它当进度等待；
- 过滤输出时保留原命令的退出状态（Nushell 用 `| complete`）；
- 服务和 watcher 用后台 job 启动，保留返回的 handle，不要用 `&` 再靠 `ps | grep` 去找。

这些属于进程管理和模型行为，不是语法问题。dsh-nu 负责 shell 语法边界，harness 负责等待和退出状态。

## 什么情况下不要用 dsh-nu

- 你需要 dsh-nu 没实现的 shell，例如某个运行时只提供 bash 入口。可以用 allowlist 和 `enforceNushellOnly: false`，但这样就失去了 dsh-nu 原本要提供的保证。
- 你用的 dsh 或 Nushell 不是测试组合。bundle 仍会启动，但会给出警告；非 Nushell 语法拦截规则和 hint 只针对那一组版本调过。
- 你需要模型侧的 shell 工具提供 Windows PowerShell 语义。Windows 上工具名仍然是 `pwsh`，但实际执行的是 Nushell。

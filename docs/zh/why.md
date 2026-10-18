# 为什么只要 Nushell

[English](../why.md) | 中文

## 混合 shell 的问题

一个可以启动 bash、zsh、fish 和 PowerShell 的编码代理，往往会写它最近见过的方言。结果是一条看起来合理、失败原因却对模型不可见的命令：flag 属于另一个 shell、重定向其实是比较、环境变量语法不对。工具输出随后会教模型换一种方言再试，而不是修正命令。

## Nushell 改变了什么

Nushell 只有一套执行模型：命令作为单个进程运行，管道传递结构化值，重定向、变量和控制流各只有一种写法。这消除了“这段代码属于哪个 shell”的猜测，也给模型有用的结构：`ls | where size > 1mb` 操作的是数据，而不是格式化后的文本。

## 这个插件包增加了什么

- **唯一执行器**：每次 shell 调用都变成 `nu --no-config-file -c "<command>"`，harness 不会为模型启动 bash 或 PowerShell。
- **Guard**：任何把工作交给其他 shell 的命令都会在创建进程前被拒绝，并引用出问题的语句。
- **方言预检**：在 Nushell 中会失败的 bash / PowerShell 习惯会被拒绝，并给出对应的 Nushell 写法。
- **Hint**：Nushell 真实报出的失败会追加一行可操作的修复提示。
- **教学层**：shell 工具描述、PTC SDK 文本和 prompt 中的简短规则都按 Nushell 描述，模型不会从工具 schema 里学到旧方言。

规则和 hint 都针对固定版本 Nushell 的真实行为测试过，不是对 Nushell 行为的猜测。

## 什么情况下不适合

- 你需要这个项目没有实现的 shell（例如只提供 bash 入口的运行时）。allowlist 和 `enforceNushellOnly: false` 可用于这种情况，但会放弃这个插件包要提供的保证。
- 你使用的 dsh 或 Nushell 不是受支持的固定组合。插件会带警告启动，但方言规则和 hint 只针对固定版本调优。
- 你需要模型侧 shell 工具提供 Windows PowerShell 语义。Windows 上工具名仍是 `pwsh`，但背后的程序是 Nushell。

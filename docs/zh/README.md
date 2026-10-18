# dsh-nu

[English](../../README.md) | 中文

一个 DeepSeek Harness 插件包：让 **Nushell 成为编码代理唯一可用的 shell**，并教模型写 Nushell，而不是 bash 或 PowerShell。

每次 shell 调用都是一个独立进程：

```text
nu --no-config-file -c "<command>"
```

这个包注册唯一的 `ctx.shell` provider，把模型看到的 shell 工具描述替换成 Nushell 说明，并在 system prompt 里加上简短规则和语法指南。任何把工作交给其他 shell 的命令都会在创建进程之前被拒绝；bash / PowerShell 习惯会得到带 Nushell 写法的本地错误。

## 状态

预发布。支持 dsh `0.2.1-rc.2` 与 Nushell `0.115.1`，记录在 `package.json` 的 `testedWith`。

## 安装

这个包通过 npm 发布。首次公开 release 之前，请从 release tarball 或本地 checkout 安装。

## 开发

```sh
npm install
node dev/link-peers.mjs --root <dsh-install-root>
npm run typecheck
npm test
npm run build
```

`dev/link-peers.mjs` 把 dsh 的 peer 包链接进 `node_modules`，测试可以直接驱动真实 seam，而不需要发布。

## 配置

bundle patch 是 `cordis.patch.yml`。`examples/preset-nu-shell.md` 列出了需要关闭的 preset 级 shell 绕过项。

## 文档

- [为什么只要 Nushell](why.md)
- [故障排查](troubleshooting.md)
- [验证](verification.md)
- [Nushell 摩擦审查](nushell-friction-review.md)
- [分发与支持（ADR）](../adr/0001-distribution-and-support.md)

## 致谢

本项目的 Nushell-only shell、guard 与教学思路来自
[YMRwithNoworry/dsh-nushell-only](https://github.com/YMRwithNoworry/dsh-nushell-only)（MIT），
它是这些思路的原始实现。

感谢 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 项目提供本插件扩展的 shell seam。

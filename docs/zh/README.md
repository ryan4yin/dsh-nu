# dsh-nu

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

[English](../../README.md) | 中文

dsh-nu 强制 DeepSeek Harness 用 Nushell 执行所有 shell 命令，禁用 `bash` / `pwsh` 执行器。它主要做三件事：

- **换执行器**：通过 DeepSeek Harness 提供的底层扩展接口，在运行时把 `bash` / `pwsh` 执行器换成 Nushell 执行器（命令通过 `nu --no-config-file -c "<command>"` 执行）。dsh 侧看到的仍然是同一个 `bash` / `pwsh` 工具，调用方式不用变；这让 Nushell 执行器能无缝接入 dsh，兼容其他插件与功能。代价是看起来会有点奇怪：调用 `bash`/`pwsh` 工具，传入的却是 Nushell 脚本。
- **教模型**：在 system prompt 里加入一小节 Nushell 规则和语法指南；这部分教学内容会占用一定上下文，但很关键，关掉后模型调用 shell 工具时会频繁报错。
- **拦 handoff**：Nushell 命令如果把工作交给其他 shell，guard 会在进程启动前拒绝它。Nushell 会拒绝或静默误读的 bash / PowerShell 语法由语法规则拦下，并在错误信息中给出对应的 Nushell 写法。

## 状态

0.4.0 已发布到 npm。当前测试组合是 dsh `0.2.1-rc.2` 与 Nushell `0.115.1`，记录在 `package.json` 的 `testedWith` 里。

## 兼容性

dsh-nu 只支持这一组合。peer 依赖只覆盖 dsh 家族；启动时如果安装的 dsh 或 Nushell 与测试组合不同，会输出警告。其他版本没有测试过。

## 安装

需要 Node 22.19+、`PATH` 上的 `pnpm`（`dsh plugin` 安装器会调用它）、dsh `0.2.1-rc.2` 和 Nushell `0.115.1`。

把 bundle 装进 dsh profile：

```sh
dsh plugin --profile tui add dsh-nu@0.4.0
```

浏览器界面把 `--profile` 换成 `web`。第一次运行 `dsh plugin` 会创建 profile；bundle 的 patch 会停用平台 shell 执行器，挂载 Nushell 执行器和教学层。用 `dsh tui`（或 `dsh web`）启动。

刚发布时，pnpm 可能因为 `minimumReleaseAge` 报 `ERR_PNPM_NO_MATURE_MATCHING_VERSION`。等过冷却期，或者在原命令后加上 `--config.minimumReleaseAge=0`。

## 开发

仓库自带 flake，提供测试过的 Node 和 Nushell 版本：

```sh
nix develop
```

进入 shell 后，或者本机已有 Node 24 和 Nushell 0.115.1 时：

```sh
npm install
node dev/link-peers.mjs --root <dsh-install-root>
npm run typecheck
npm test
npm run build
```

`dev/link-peers.mjs` 会把 dsh 的 peer 包链接到 `node_modules`，测试因此能直接使用真实的 shell seam，不需要先发布。

测试跑在 Node 24 上。npm 允许安装到 Node 22.19 及以上，但除 24 之外的版本没有测试过。

## Nix

dsh-nu 不打包 dsh 本身。这个 flake 从当前 checkout 构建插件，dsh 安装则来自打包 dsh 的 flake。下面这个完整示例用 `nur-ryan4yin`，它的 `dsh` 还提供应用 bundle patch 的 `withPlugins` 包装：

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # dsh 本身，以及它的 withPlugins 包装。
    nur-ryan4yin = {
      url = "github:ryan4yin/nur-packages";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # bundle 本身，从本仓库的 flake 构建。不要 follow 它的 nixpkgs：
    # 那个固定版本提供经过测试的 Nushell。
    dsh-nu.url = "github:ryan4yin/dsh-nu";
  };

  outputs = { self, nixpkgs, nur-ryan4yin, dsh-nu }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};

      # dsh 来自 nur-ryan4yin；withPlugins 负责应用 bundle patch。
      dsh = nur-ryan4yin.packages.${system}.dsh;
      dshWithNu = dsh.withPlugins [
        (dsh-nu.lib.mkDshNuPackage { inherit pkgs dsh; })
      ];
    in {
      packages.${system}.default = dshWithNu;

      # 把 `dshWithNu` 装到原本放 dsh 的位置，例如：
      #   environment.systemPackages = [ dshWithNu ];
      #   home.packages = [ dshWithNu ];
    };
}
```

`nix build` 产出的就是这个 `dsh` 可执行文件。`mkDshNuPackage` 只需要 dsh 安装里的 `@deepseek-ai` peer 包，`llm-agents.nix` 的 dsh 也可以传进来；应用 bundle 仍然需要一个加 `--patch` 的包装，这由 `nur-ryan4yin` 的 `withPlugins` 提供。用 `nix flake update dsh-nu` 更新 bundle。

## 配置

bundle 的 patch 挂载一个 executor 行和一个 teaching 行；profile patch 按 id 覆盖其中任意一行。下面这个 profile patch 列出所有字段及其默认值：

```yaml
- id: nu-executor
  name: dsh-nu/executor
  config:
    nuPath: ""
    nuArgs: ["--no-config-file", "-c"]
    timeoutMs: 60000
    enforceNushellOnly: true
    syntaxLint: true
    syntaxHints: true
    requireNu: true
    verifyNu: true
    verifyTimeoutMs: 10000
    foreignShellAllowlist: []

- id: nu-teaching
  name: dsh-nu/teaching
  config:
    guide: full          # full | compact | off
    rules: true
    rewriteToolDescriptions: true
    toolNames: ["bash", "pwsh"]
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `nuPath` | `$DSH_NU_PATH`，否则 `nu` | Nushell 可执行文件：先看字段，再看环境变量，最后看 PATH |
| `nuArgs` | `["--no-config-file","-c"]` | argv 前缀；命令追加在最后 |
| `enforceNushellOnly` | `true` | 拒绝把命令交给其他 shell |
| `foreignShellAllowlist` | `[]` | 豁免两项预检检查的正则；必须匹配整条命令 |
| `syntaxLint` | `true` | 启动进程前拦下 bash/PowerShell 语法 |
| `syntaxHints` | `true` | 调用失败时追加一行 `Nushell hint (…)` |
| `guide` | `full` | prompt 指南：`full`、`compact`、`off` |
| `rules` | `true` | 在 prompt 前加上 shell 规则段 |
| `rewriteToolDescriptions` | `true` | 改写 `bash` / `pwsh` 工具描述 |
| `toolNames` | `["bash","pwsh"]` | 改写哪些工具 schema 的 shell 文本 |
| `timeoutMs` | `60000` | 单次调用默认超时；`maxTimeoutMs` 限制覆盖值 |
| `requireNu` / `verifyNu` | `true` / `true` | nu 无法解析、报不出版本或无法运行预检时，启动直接失败 |
| `verifyTimeoutMs` | `10000` | 版本探测的超时时间 |

两项检查都通过两个只读探针读取 Nushell 的解析结果，脚本写在私有临时目录里。`verifyNu` 开启且至少一项检查启用时，启动会跑一次 token/diagnostic 金丝雀：默认的 `requireNu` 下失败会直接启动失败；设成 `requireNu: false` 时，每次调用会被拒绝，而不是跳过检查继续执行（fail closed）。错误信息会给出 `enforceNushellOnly: false`、`syntaxLint: false` 这两个开关，并提示更新到测试版本。

按目标选 guide：

- `off` 只关闭指南；除非 `rules: false`，规则段仍然保留。它只用于诊断对照：评测中出现了明显更多的预检拒绝和重试，正常会话不要用。
- `compact` 覆盖常见写法，prompt token 更少；评测里大多数样本没有触发拒绝。
- `full` 保留完整语法参考，覆盖不常见写法和边界情况。

沙箱预算（`cwd`、`timeoutMs` 等）配在 `nu-executor` 行上，不放进 dsh 共享的 `shell` 设置。要覆盖某一行，在 profile 自己的 `cordis.patch.yml` 里按 id 改。`examples/preset-nu-shell.md` 列出了需要关闭的 preset 级 shell 绕过项。

## “只要 Nushell”覆盖不到的地方

guard 不是沙箱：它检查自己能读到的命令位置，其余情况不在覆盖范围内。

- 普通引号字符串里的 shell 名称只是数据，不是命令位置：`'bash -c "echo hi"'` 求值成一个字符串，不会运行 bash。`$"…"` 和 `$'…'` 会插值，其中每个括号表达式都会作为代码检查；表达式里的引号文本仍是数据。
- 字面量 `nu -c '<script>'` 或 `nu -e '<script>'` 会递归检查，最多四层；运行时拼出来的脚本不会。
- Nushell 脚本文件不会被读取：`nu script.nu`、`source` 和 `use` 加载的代码 guard 看不到，所以先写进文件再这样运行的交接不在覆盖范围内。
- 运行时才确定的 shell 名称，或者自己会启动 shell 的程序（语言运行时、编辑器），都不在覆盖范围内。guard 只跟踪字面量 shell 名称、固定的 launcher 表（包括 `nix shell` / `nix develop --command` 和 `nix run`）、`run-external` 和字面量 `nu -c` 脚本。
- preset 自己启动 shell 的行，例如直接调用 `ctx.subprocess.spawn` 的插件，或 PTY 常驻 shell 组。严格部署时应关闭，见 `examples/preset-nu-shell.md`。
- 其他 shell seam 不在 dsh-nu 的范围内：hook 桥、常驻终端和 tmux context 使用各自的服务或脚本。严格部署时应保持关闭。
- dsh-nu 不改沙箱本身：`danger-full-access` 直接运行，受限模式通过 `ctx.sandbox.confine()` 包装 Nushell argv，`mode` / `denied` / `enforcement` 的报告方式保持不变。
- 预检的解析器探针（`nu --ide-ast` 和 `nu --ide-check`）在沙箱外、命令运行之前执行。它们只解析不运行命令，但 `source` 或 `use` 指向的文件会被读取来解析；文件内容不会返回给模型。

## 文档

- [为什么只要 Nushell](why.md)
- [故障排查](troubleshooting.md)
- [验证](verification.md)
- [Nushell 摩擦审查](nushell-friction-review.md)
- [分发与支持（ADR）](../adr/0001-distribution-and-support.md)
- [基于解析器的预检（ADR）](../adr/0004-ast-based-preflight.md)
- [术语表](../../GLOSSARY.md)

## 许可证

MIT，见 [LICENSE](../../LICENSE)。

## 致谢

本项目的 Nushell-only shell、guard 和教学思路来自
[YMRwithNoworry/dsh-nushell-only](https://github.com/YMRwithNoworry/dsh-nushell-only)（MIT），
它是这些思路的原始实现。

感谢 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供 dsh-nu 扩展的 shell seam。

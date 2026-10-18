# dsh-nu

A DeepSeek Harness bundle that makes **Nushell the only shell** a coding agent can use, and teaches the model to write Nushell instead of bash or PowerShell.

Every shell call runs as one isolated process:

```text
nu --no-config-file -c "<command>"
```

The bundle registers the single `ctx.shell` provider, replaces the model-facing shell tool descriptions with Nushell ones, and adds a short rules section plus a syntax guide to the system prompt. Commands that hand work to another shell are rejected before a process exists, and bash/PowerShell habits get a local failure with the Nushell spelling.

## Status

Pre-release. The supported pair is dsh `0.2.1-rc.2` and Nushell `0.115.1`, recorded in `package.json` under `testedWith`.

## Install

This package is distributed through npm. Keep the repository private and install from a release tarball or a local checkout until the first public release.

## Development

```sh
npm install
node dev/link-peers.mjs --root <dsh-install-root>
npm run typecheck
npm test
npm run build
```

`dev/link-peers.mjs` links the dsh peer packages into `node_modules` so the test suite can drive the real seams without publishing.

## Configuration

The bundle patch is `cordis.patch.yml`. `examples/preset-nu-shell.md` lists the preset-level shell bypasses to disable.

## Acknowledgements

The Nushell-only shell, guard, and teaching ideas in this project come from
[YMRwithNoworry/dsh-nushell-only](https://github.com/YMRwithNoworry/dsh-nushell-only) (MIT),
the original implementation of those ideas.

Thanks to the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) project for the
shell seam this bundle extends.

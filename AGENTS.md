# Agent guide

This repository contains a DeepSeek Harness bundle that makes Nushell the only shell. The README and `docs/` are for users; this file is for agents changing the code.

## Commands

```sh
npm install
node dev/link-peers.mjs --root <dsh-install-root>
npm run typecheck
npm test                        # unit, differential, hints, claims, docs, manifest
npm run build
npm run test:integration        # real dsh boot: native + PTC (POSIX)
npm run probe                   # composed config probe against the real dsh
npm run eval -- --dsh-home <dir> --model-patch <file> --label <name> --samples 3
npm run eval:judge -- --run <eval-dir> --dsh-home <dir> --model-patch <file> --label <name>
npm run eval:judge-summary -- --dir <judge-dir> --dir <judge-dir>
npm pack --dry-run
```

## Architecture map

- `src/executor.ts`: the single `ctx.shell` provider. It extends the first-party sandbox executor and replaces only the argv with `nu --no-config-file -c`.
- `src/ast.ts`: the parser probe. Runs `nu --ide-ast` and `nu --ide-check` over a private temp script, converts byte offsets, and caches analyses; a probe failure is fatal to the command.
- `src/guard.ts`: foreign-shell detection over Nushell's flat token stream, with the launcher table, `run-external`, and literal `nu -c` recursion.
- `src/syntax.ts`: syntax-preflight rules over parser diagnostics and token shapes, failure hints, and their ids.
- `src/guide.ts`: reads the model-facing rules, syntax guides, and tool descriptions from `src/guides/*.md`; the build copies the four model-facing files to `dist/guides`. `src/guides/README.md` records sources and maintenance steps.
- `src/native-executor.ts`: replaces dsh's native tool executor; its `describe()` rewrites the `bash` / `pwsh` schemas, which dsh no longer passes through `system-prompt/assemble`.
- `src/teaching.ts`: system-prompt sections, the PTC `tools:sdk` rewrite, and the shared tool-schema rewrite.
- `src/nu.ts`: executable choice, argv prefix, tested pins, and version helpers.
- `cordis.patch.yml`: disables the platform shell rows and dsh's native tool executor, and mounts this bundle.
- `nix/dsh-nu.nix`: the flake package, reached through `lib.mkDshNuPackage`; the caller supplies `pkgs` and the `dsh` installation it plugs into, so no release tarball or NUR copy is involved.
- `eval/`: manual real-model harness with `full`, `compact`, and `off` arms, cross-model judging, and dated reports. Raw samples stay out of the repository.

## Rules

- Do not copy files or code blocks from the archived implementation. Treat it as a capability checklist and reimplement from observed behaviour.
- A model-facing claim that can be executed needs a test that executes it. A hint or rule needs a real failing Nushell sample.
- Teaching changes need an eval case when the effect is observable; run three samples per case and arm before deciding a wording. The eval is manual, not PR CI.
- Run evals in layers: small model and the failing case first, expand cases and models only after that passes, and reserve the full matrix for acceptance. See `eval/README.md`.
- Keep the tested pair in `package.json` `testedWith` and the peer ranges in sync. `test/package-contract.test.ts` enforces both.
- Run the local suite before opening a PR. CI is the platform matrix gate, not the debugging loop.
- Every commit and generated PR description carries the `Assisted-by: DeepSeek Harness (<model>)` trailer.

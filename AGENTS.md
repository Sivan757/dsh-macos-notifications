# AGENTS.md

Instructions for working in this repository. It ships one DeepSeek Harness plugin: six native macOS notification switches in the host configuration window.

## Layout

```
src/            host.js (server side), client.js (settings section), shared.js (wire vocabulary),
                store.js (settings file), notifications.js (renderer delivery)
scripts/        build.mjs (host + client bundle), check-host-support.mjs (host pin gate)
test/           node:test suites over the built artifacts
locale/         en.json and zh.json display metadata for the plugin manager
cordis.patch.yml  the bundle row the host applies
.github/        quality, CodeQL, and the workflow-owned release chain
```

## Commands

```sh
pnpm run build            # scripts/build.mjs writes lib/
pnpm run test             # node --test over test/*.test.js; pretest runs the gates
pnpm run check:refactor   # host support window + prettier
pnpm run check:host-support
```

## Host compatibility

Every host pin carries the support window `>=0.2.0-rc.2 <0.3.0-0`; only `devDependencies` carry an exact build baseline. The harness evaluates these ranges against the running dsh version and marks a mismatched plugin abnormal in its own manager, so a caret on one candidate is a defect, not a detail. `scripts/check-host-support.mjs` enforces the rule and also fails when the host `next` channel leaves the window.

## Conventions

- Behaviour reaches the user through the host window only; the plugin never starts a separate server.
- User-visible strings are bilingual: `locale/` pairs for display metadata, and `COPY` in `src/shared.js` for the settings section.
- Notifications stay fixed text. They never carry transcript content, tool arguments, or file paths.
- A change to the window, the wire vocabulary, or the storage path updates `README.md` and `README.zh.md` in the same edit.

# Splitting the core from the web server

ccdesk's reading and writing code should be usable without the HTTP server, so that a command-line tool and a terminal UI can sit beside the web page and share it. This plan lists the steps in order. Each step keeps `pnpm check` green and ships on its own. [ARCHITECTURE.md](../ARCHITECTURE.md) describes the code as it is now.

## Decision: one package with subpath exports first

The core stays a folder in this package, reached through `exports` subpaths in `package.json` (`ccdesk` today; later `ccdesk/core` and `ccdesk/view`). It becomes a separate workspace package only when a CLI or TUI needs to be released on a different schedule from the web app. Until then a split would mean changing the test glob, both tsconfigs, Biome's file list, the release workflow, release-it's config and the data workflow's `git add` list together, for no user-visible gain.

## Done

These landed after v0.2.2.

- **The core is importable.** `src/core/index.ts` re-exports the scan, the watcher, every preview and save, backups, the errors and the shared types. The build emits declarations, `package.json` maps `"."` to `dist/core` with its types, and CI imports the packed package. Test: `test/core.test.ts`.
- **Edit input is checked in the core.** The parsers that were in `server.ts` are `parseSettingsEdit`, `parsePermissionEdit`, `parseHookEdit`, `parseAgentEdit` and `parseMcpEdit` in `src/server/parse-edit.ts`, throwing `InvalidEditError` (400). Planning a hook edit already refused unknown events. Test: `test/core-parse.test.ts`.
- **A core-level round trip.** `test/core-edits.test.ts` saves and undoes a permission edit through the core. Settings, agent, project MCP and memory round trips stay in `test/server.test.ts`, whose routes pass edits straight to the same functions.
- **Generated data comes from the server.** The settings schema, catalog and hook events are exported from the core as `REFERENCE` and served by `/api/reference`, so the page no longer bundles them (913 kB to 496 kB).

## Remaining steps

### 1. Give the core its seams

Scope: a `createCore(env, { runClaude?, openFile? })` that returns bound methods, with `server.ts`'s `routes()` taking a core instead of `ServerOptions`. `open.ts` and `mcp-edit.ts` stop reading `process.platform` and `process.env` (`openInEditor` and `launch` in `open.ts`; `claudeProgram`'s defaults and `runClaude`'s environment in `mcp-edit.ts`) and take them from `ScanEnv` or the core's options. Move the module-level queues and caches (`write.ts`, `scan/usage.ts`, `settings-edit.ts`) onto the instance. Keep the free functions exported as thin wrappers for one release.

Done when: two cores built in one test process on two fixtures do not share a queue or a cache, and a fixture with `platform: "win32"` gets the Windows editor and `claude` spawn plan.

### 2. Split the CLI

Scope: `cli.ts` today parses flags, starts the server and opens the browser in one `main()` that runs on import, with its own browser launcher, `openBrowser`. Split it into a pure `parse(argv)`, a `startServer(options)` that returns `{ url, close }`, and a short bin. Open the browser through `open.ts`'s spawn plan.

Done when: `parse` has unit tests for the flags and errors, `startServer` runs in a test with `uiDir: null`, and CI's pack smoke test still passes.

### 3. Move the files

Scope: `src/server/scan`, `write.ts`, the edit modules, `parse-edit.ts`, `backups.ts`, `watch.ts`, `secrets.ts`, `schema.ts` and `reference.ts` move to `src/core/`; `src/server` keeps `server.ts` and the CLI. On the way, split `scan/files.ts` (490 lines) into file reading, git, and redaction, merging `secrets.ts` into the last. Imports change; logic does not.

Done when: `src/core` imports nothing from `src/server`, the diff outside import lines is empty, and `tsconfig.build.json` lists the new folders.

### 4. Pull the view logic out of React

Scope: each `src/ui/sections/*.tsx` mixes plain data functions (`rows`, `columns` sort keys, `text`, `label`, `heading`, `dimmed`, `facet`, `empty`) with JSX (`cells`, `Head`, `Details`). Move the data half to `src/view/` with no React import, along with `valueHere` (catalog), `outcome` and `callsOf` (tools), `suggestedRules` (`usage.ts`), the scope vocabulary in `lines.ts`, `fieldKind`, `valuesIn` and the diff in `diff.ts`. Replace `format.ts`'s `setHome` with a `formatter(home)`. Move `test/catalog.test.ts` and `test/diff.test.ts` with their code. Export it as `ccdesk/view`.

Done when: `src/view` has no `react` import, the page renders the same rows, and a Node test builds every section's rows from a fixture's `DirectoryView`.

### 5. Push changes instead of long polling

Scope: add `Watcher.subscribe(dir, onChange)` returning an unsubscribe function, built on the existing per-directory waiters in `watch.ts`. Keep `wait()` for `/api/watch`.

Done when: a test sees `onChange` called once after a watched file changes, and not after unsubscribing.

### 6. Build a CLI on the core

Scope: subcommands of the existing `ccdesk` bin, such as `ccdesk scan --json` (see [feature ideas](feature-ideas.md)), importing only `ccdesk` (the core), never `src/server/server.ts`.

Done when: the subcommands work from the packed package, and their output is tested against a fixture. Decide on workspace packages only after this, and only if the release schedules need to differ.

Steps 1 to 3 and 5 touch no page code. Step 4 is needed only for a TUI; the CLI in step 6 needs steps 1 and 2.

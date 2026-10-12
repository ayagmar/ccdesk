# Architecture

ccdesk is one npm package: a Node server in `src/server` that reads and writes Claude Code's configuration, and a React page in `src/ui` that talks to it over HTTP. `src/shared` holds the types both sides use. `src/core/index.ts` re-exports the parts of `src/server` and `src/shared` that do not depend on HTTP, and is the package's import entry point (`import { scanDirectory } from "ccdesk"`). The [contributing page](https://ayagmar.github.io/ccdesk/contributing/) covers the development loop, the generated data and releases; this file covers how the code fits together.

## Module map

| Path | What it does |
| --- | --- |
| `src/server/cli.ts` | Parses the flags, builds a `ScanEnv`, starts the server, opens the browser. |
| `src/server/server.ts` | The `/api/*` routes, the token, Host and Origin checks, security headers, and the built UI. Turns errors into status codes. |
| `src/server/scan/` | Reads. `index.ts` has `scanOverview` and `scanDirectory`; the other files each read one part (settings, instructions, memory, MCP, plugins, permissions, tools, context, usage, compare, path-test). `env.ts` defines `ScanEnv`. |
| `src/server/settings-edit.ts` | Settings, permission and hook edits, all in settings files. |
| `src/server/agent-edit.ts`, `mcp-edit.ts`, `mutations.ts` | Subagent files, MCP servers, and auto memory. |
| `src/server/parse-edit.ts` | Turns untrusted input (a JSON body) into a typed edit, or throws `InvalidEditError`. |
| `src/server/write.ts` | What every write shares: atomic writes through links, the backup folder and its manifest, the queue that runs changes one at a time, `RefusedError` and `StaleError`. |
| `src/server/backups.ts` | Lists, previews and restores backups (Recent changes and Undo). |
| `src/server/secrets.ts`, `scan/files.ts` | What the page may see: `redactSecrets`, `shownText`, `shown`, `hasHiddenValues`. |
| `src/server/watch.ts` | `Watcher`: scans a directory, watches the files the scan read, and answers the page's long poll. |
| `src/server/reference.ts` | The settings schema, settings catalog and hook events, served by `/api/reference`. |
| `src/server/open.ts` | Opens a file in your editor. |
| `src/core/index.ts` | The import entry point; re-exports, moves nothing. |
| `src/shared/` | Types (`types.ts`), scope lists, and the JSON generated from Claude Code's SDK and docs. No Node or DOM imports. |
| `src/ui/` | The page. Imports only `src/shared` and calls the server through `api.ts`. `sections/` defines each table on the directory page. |

## From disk to the page

```
ScanEnv → scanDirectory(env, dir, profile) → DirectoryView → /api/directory → sections → rows
```

`ScanEnv` holds every location ccdesk reads: home, the Claude folder, `.claude.json`, the managed folder, and the platform. `scanEnvFromProcess` builds it from the real machine; tests build one around a throwaway folder with `makeFixture()`. Every read and write takes it as its first argument, so nothing in the core reads `homedir()` itself.

`scanDirectory` returns one `DirectoryView`: the instruction files, settings layers and effective settings, permissions, built-in tools, memory, hooks, MCP servers, extensions, context, trust, sharing and problems for one directory and session profile. The page fetches it through `Watcher.scan`, which also records the files the scan read so a change to any of them wakes `/api/watch`. On the page, `useConfig` holds the view, `sections/index.ts` lists the sections in page order, and each section turns the view into rows.

Usage counts arrive separately: the page posts the rules in effect to `/api/usage` after each scan, and `readUsage` counts calls in the transcripts. The settings schema and catalog are fetched once from `/api/reference`; no directory is shown before they arrive.

## Secrets

Values under `env` and `headers`, keys in URLs, and secret-looking arguments of MCP servers are replaced with `•••` by `redactSecrets` in `scan/files.ts`. The scan applies it before a value goes into a `DirectoryView`, and every preview and restore preview shows files through `shownText` or `shown`, so a hidden value never reaches the browser, diffs included. Files named like the credentials file, or linked to it, are never read (`isSecretPath`, `isCredentials`).

ccdesk never writes back a value the page saw as `•••`. Settings, hook and agent edits refuse when the value they change holds a hidden value, or when the new value would be hidden (`settings-edit.ts`, `agent-edit.ts`). Restoring a settings or MCP file is refused when its hidden values changed since the backup, unless the file no longer parses. A new MCP server may hold the env values and headers you type for it.

## Review, then save

Every edit runs twice: once to show it, once to make it.

1. `preview*(env, edit)` plans the edit from the file on disk and returns the diff and a `revision`, a fingerprint of what it read. A memory change binds two files (the memory and `MEMORY.md`) into one revision.
2. `save*(env, edit, revision)` plans the same edit again and writes only if the revision still matches. It returns a `Change`: `id` (its backup folder), `target`, the file's `revision` after the change, and `created` when the file did not exist.
3. Undo is `restoreBackup(env, change.id, change.revision)`. Recent changes uses `listBackups`, then `previewRestore(env, id)` for the diff and its revision, then `restoreBackup` with that revision.

Errors a front end should handle:

- `InvalidEditError`: the input is not a well-formed edit (unknown scope, missing field). The server answers 400.
- `RefusedError`: ccdesk will not make the change. That covers a file changed since the preview, schema errors, hidden values, managed settings, credentials and `~/.claude.json`, so the message says which. The server answers 409.
- `StaleError`, a subclass of `RefusedError`: the file changed while ccdesk was writing it, after the revision check. Nothing was written and no backup is kept. A front end treats it like any `RefusedError`: review again.

Changes that cannot be undone from ccdesk:

- User and local MCP servers. They live in `~/.claude.json`, which ccdesk never writes, so `saveMcpEdit` runs `claude mcp` and returns `{ target }` instead of a `Change`. Recent changes lists the change with the commands that reverse it.
- A change that created its file and stopped halfway, or whose file changed after ccdesk created it: ccdesk will not remove a file it cannot tell it wrote.
- Putting a deleted memory back. Delete it again instead.

## Backups

Each change gets a folder in `<Claude folder>/backups/ccdesk/<id>/`, readable only by you. The id is the time, a random suffix and the kind, such as `2026-10-12T19-15-02-123Z-a1b2c3-settings`, so ids sort by time.

- `before`: the file before the change. Absent when the change created the file.
- `ccdesk-backup.json`: the manifest. `kind`, `target`, `createdAt`, the `before` revision (`missing` for a created file) and the `after` revision. `after` is `pending` while the change runs and `partial` if it failed after writing something. A deleted memory also records the `MEMORY.md` lines removed with it.
- `after`, for `claude mcp` changes only: the affected servers after the change, values hidden. Their manifest holds `undoCommands`.

The manifest and `before` are written before the change, so an interrupted change can still be restored. A change that fails without changing the file removes its folder.

## Process-wide state

These live in module scope, so every caller in one process shares them:

- `write.ts`: the queue behind `serially`, which runs every change one at a time so two saves cannot both pass the revision check.
- `scan/usage.ts`: the transcript cache, its queue, and the requests waiting on a count.
- `settings-edit.ts`: compiled schema validators. `schema.ts`: the shared Ajv instance.
- In the page: `format.ts` keeps the home folder for `tilde()`, and `reference.ts` keeps the data from `/api/reference`.

`Watcher` is per instance; the server makes one. `openFile` and `runClaude` are passed to `createCcdeskServer` so tests replace them.

## Docs citations

Some behaviour is copied from prose in Claude Code's docs, such as how rules match commands. The code cites the section in a `docs: page#anchor` comment, and `pnpm docs:fingerprints` hashes each cited section so the daily data workflow can list the ones whose text changed.

## Further reading

- [docs/split-plan.md](docs/split-plan.md): splitting the core from the web server so a CLI and a TUI can use it.
- [docs/feature-ideas.md](docs/feature-ideas.md): features the code is close to supporting.

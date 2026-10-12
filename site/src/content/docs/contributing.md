---
title: Contributing
description: The development loop, the generated Claude Code data, the docs site, and how releases are made.
---

ccdesk is a Node.js server in TypeScript (`src/server`) that serves a React app built with Vite (`src/ui`); `src/shared` holds the types both use and the data generated from Claude Code. Tests use `node:test`, linting and formatting use Biome, and packages are managed with pnpm. The source is on [GitHub](https://github.com/ayagmar/ccdesk).

## Development loop

```sh
pnpm install
pnpm dev        # API on 127.0.0.1:4319 with the token "dev"
pnpm dev:ui     # UI with hot reload on port 4320, using the API above
pnpm check      # typecheck, lint, format check, tests, build
```

`pnpm check` is what CI runs on Linux (Node 22 and 24), macOS and Windows. CI also packs the npm package, installs it into an empty folder, starts it in an empty home folder and loads the page, so a file missing from the package fails the build.

Tests never touch your real `~/.claude`. Each test process gets a throwaway home folder, git configuration and environment, network access is blocked, and each test builds its own fixture.

## How the code fits together

- `src/server/cli.ts` parses the flags, builds a `ScanEnv` with `scanEnvFromProcess`, binds it to a core with `createCore` and starts the server from `server.ts`, which answers the `/api/*` routes and serves the built UI. Every `/api/` request needs the per-run token in the `x-ccdesk-token` header.
- `src/server/scan/` reads. Every function takes the `ScanEnv` (home, Claude folder, `.claude.json`, managed folder, platform, and the environment ccdesk finds your editor and `claude` in), so tests point it at a fixture instead of your machine. `scanDirectory` returns the `DirectoryView` a page shows, and `scanOverview` the start page.
- The edit modules (`settings-edit.ts`, `agent-edit.ts`, `mcp-edit.ts`, `mutations.ts` for memory) and `backups.ts` write. `write.ts` holds what they share: atomic writes through links, the backup folder and its manifest, and the queue that runs changes one at a time.
- `watch.ts` watches the files a scan read and wakes the page's long poll on `/api/watch` when one changes. `~/.claude.json` is not watched; the page reloads when you return to the tab.
- `src/shared` holds the types and generated data, and imports neither Node nor the DOM. `src/ui` imports only `src/shared` and talks to the server through `src/ui/api.ts`; it gets the settings schema, settings catalog and hook events from `/api/reference` instead of bundling them.
- `src/core/index.ts` re-exports the reading and writing code without the HTTP server. It is what `import ... from "ccdesk"` loads. `createCore(env)` in `src/core/core.ts` returns that code with `env` already passed, its own change queue and usage cache; the server routes call a core, and tests give it fake `runClaude` and `openFile` functions.

Every edit goes through the same steps. The UI sends the edit to a `preview` route, which returns the diff and the `revision` of what it read. The save route takes the same edit with that revision, plans it again from the file on disk and writes only if the revision still matches; otherwise it throws `RefusedError` (409), and the page asks you to review again. The same error also refuses edits ccdesk never makes, such as to managed settings or credentials, so its message says which case it is. A save returns a `Change` whose `id` is its backup folder, which is what Undo and Recent changes restore. User and local MCP edits are the exception: they run `claude mcp`, keep no backup and return no `Change`.

Request bodies are turned into edits by the parsers in `parse-edit.ts`, which throw `InvalidEditError` (400) for input no review could have produced, such as an unknown scope.

Values ccdesk hides on the page (env values, headers, keys in URLs and arguments) are redacted in the scan, so they never reach the browser. ccdesk never writes back a value the page saw as `•••`, so a setting, server, hook or agent that holds one is edited in its file instead. Settings, hooks and agents also refuse new values the review would hide; a new MCP server may hold the env values and headers you type for it.

[ARCHITECTURE.md](https://github.com/ayagmar/ccdesk/blob/master/ARCHITECTURE.md) in the repository goes further: the module map, where secrets are hidden, the backup folder layout and what state each core keeps. The [`docs/` folder](https://github.com/ayagmar/ccdesk/tree/master/docs) holds the plan for splitting the core from the web server and a list of feature ideas.

## Claude Code data

Several files in `src/shared` are generated from Claude Code's own sources:

```sh
pnpm schema     # settings.schema.json and hook-events.json, from @anthropic-ai/claude-agent-sdk
pnpm scopes     # settings-scopes.json and settings-catalog.json, from the settings reference
pnpm tools      # builtin-tools.json, from the tools reference
pnpm docs:fingerprints  # fingerprint the docs sections the code cites; prints the ones that changed
```

The settings schema comes from the `Settings` type in the SDK, which is published with each Claude Code release; CI fails if the committed schema does not match the pinned SDK. Which files each key is read from, the settings catalog and the built-in tools come from the [settings reference](https://code.claude.com/docs/en/settings-reference) and the [tools reference](https://code.claude.com/docs/en/tools-reference).

Some of Claude Code's behaviour, such as how rules match commands, is only described in prose, so ccdesk follows it by hand and cites the docs section in a `docs: page#anchor` comment. `pnpm docs:fingerprints` hashes each cited section.

A scheduled workflow runs every day: it updates the SDK to the latest version, runs all four commands, and when anything changed, runs `pnpm check` and opens a pull request that lists the docs sections whose text changed, so someone can check the code that follows them. Pull requests opened by the workflow do not start CI by themselves; close and reopen the pull request, or push to it, to run CI.

## Docs site

This site lives in `site/`, a separate package in the pnpm workspace built with [Astro](https://astro.build) and [Starlight](https://starlight.astro.build). It is not part of the npm package.

```sh
pnpm --dir site dev         # local preview with hot reload
pnpm --dir site build       # build into site/dist, then check every internal link
pnpm --dir site typecheck
```

Pages are in `site/src/content/docs/` and link to each other with relative paths such as `../settings/`. The site's address is set once, in `site/astro.config.ts`; `llms.txt`, `llms-full.txt` and the `.md` version of each page are generated from the same pages at build time.

The screenshots come from a made-up setup, never your own. `pnpm --dir site screenshots` builds a throwaway home folder in `/var/tmp/ccdesk-demo`, starts the built ccdesk in it, captures each page in both themes with a headless Chromium, and deletes the folder. It also saves the close crops the landing page's questions open to, and `regions.json`, which records where each scope's rows are in the directory screenshot so the route strip can light them up. Run `pnpm build` in the repository first. Set `CHROMIUM_PATH` to use a Chromium you already have, or run `pnpm --dir site exec playwright-core install chromium` once.

The site is deployed to GitHub Pages from `master` by the Pages workflow, which also builds it for every pull request.

## Releases

Releases are made by the Release workflow on GitHub, started by hand from `master`. It runs `pnpm check`, then release-it bumps the version from the Conventional Commits since the last tag (or by the increment you pick), writes `CHANGELOG.md`, commits, tags and creates the GitHub release. The workflow then publishes to npm with trusted publishing, so no npm token is stored. A dry run does everything except push and publish.

Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages, since they decide the version and the changelog.

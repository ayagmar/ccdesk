---
title: Contributing
description: The development loop, the generated Claude Code data, the docs site, and how releases are made.
---

ccdesk is written in TypeScript: a Node.js server and a React page built with Vite. Tests use `node:test`, linting and formatting use Biome, and packages are managed with pnpm. The source is on [GitHub](https://github.com/ayagmar/ccdesk).

## Development loop

```sh
pnpm install
pnpm dev        # API on 127.0.0.1:4319 with the token "dev"
pnpm dev:ui     # UI with hot reload on port 4320, using the API above
pnpm check      # typecheck, lint, format check, tests, build
```

`pnpm check` is what CI runs on Linux (Node 22 and 24), macOS and Windows. CI also packs the npm package, installs it into an empty folder, starts it in an empty home folder and loads the page, so a file missing from the package fails the build.

Tests never touch your real `~/.claude`. Each test process gets a throwaway home folder, git configuration and environment, network access is blocked, and each test builds its own fixture. `claude` and the editor resolve to stand-ins that fail without doing anything, so a test that wrongly uses your environment cannot start the real ones.

## How the code fits together

`src/core` reads and writes Claude Code's configuration. `src/server` holds the `ccdesk` bin and serves a core on `127.0.0.1`, `src/view` turns what the core reads into the rows the page lists, and the page in `src/ui` calls the server. `src/shared` holds the types they all use and the data generated from Claude Code. Every read and write takes a `ScanEnv`, which names the home folder, the Claude folder, the managed folder, the platform and the environment, so tests point it at a fixture instead of your machine.

Every edit runs twice. Its preview returns the diff and a `revision` of what it read; its save plans the edit again from the file on disk and writes only if the revision still matches, otherwise it is refused and the page asks you to review again. A save returns the change's backup folder, which Undo and Recent changes restore; a user or local MCP save goes through `claude mcp` and returns none.

[ARCHITECTURE.md](https://github.com/ayagmar/ccdesk/blob/master/ARCHITECTURE.md) in the repository goes further: the module map, the way from disk to the page, where secrets are hidden, the errors a front end handles, the backup folder layout and what state each core keeps. The [`docs/` folder](https://github.com/ayagmar/ccdesk/tree/master/docs) holds the plan for splitting the core from the web server and a list of feature ideas.

## Claude Code data

Several files in `src/shared` are generated from Claude Code's own sources:

```sh
pnpm schemastore  # scripts/schemastore-claude-code-settings.json, a copy of SchemaStore's schema
pnpm scopes     # settings-scopes.json and settings-catalog.json, from the settings reference
pnpm schema     # settings.schema.json and hook-events.json, from @anthropic-ai/claude-agent-sdk and the SchemaStore copy
pnpm tools      # builtin-tools.json, from the tools reference
pnpm docs:fingerprints  # fingerprint the docs sections the code cites; prints the ones that changed
```

The settings schema comes from the `Settings` type in the SDK, which is published with each Claude Code release. Some documented keys are missing from that type; for those, `pnpm schema` copies the definition from [SchemaStore's schema](https://json.schemastore.org/claude-code-settings.json), which is community maintained. It never replaces a key the SDK defines, and it only copies keys the settings reference lists, so run `pnpm scopes` first. A copied key's description, and that of each field the settings reference covers, is replaced with the reference's text, because SchemaStore's wording can disagree with the docs. Because it reads the committed copy instead of fetching, CI regenerates the schema and fails if it differs from the committed one. SchemaStore is under the Apache License 2.0; `THIRD_PARTY_NOTICES.md` carries its notice. Which files each key is read from, the settings catalog and the built-in tools come from the [settings reference](https://code.claude.com/docs/en/settings-reference) and the [tools reference](https://code.claude.com/docs/en/tools-reference).

Some of Claude Code's behaviour, such as how rules match commands, is only described in prose, so ccdesk follows it by hand and cites the docs section in a `docs: page#anchor` comment. `pnpm docs:fingerprints` hashes each cited section.

A scheduled workflow runs every day: it updates the SDK to the latest version, runs all five commands, and when anything changed, runs `pnpm check` and opens a pull request. The pull request lists the docs sections whose text changed, so someone can check the code that follows them, and the documented keys that neither the SDK nor SchemaStore defines. Pull requests opened by the workflow do not start CI by themselves; close and reopen the pull request, or push to it, to run CI. Merging one of these pull requests starts a patch release, so the new data reaches npm the same day.

## Docs site

This site lives in `site/`, a separate package in the pnpm workspace built with [Astro](https://astro.build) and [Starlight](https://starlight.astro.build). It is not part of the npm package.

```sh
pnpm --dir site dev         # local preview with hot reload
pnpm --dir site build       # build into site/dist, then check every internal link
pnpm --dir site typecheck
```

Pages are in `site/src/content/docs/` and link to each other with relative paths such as `../settings/`. The site's address is set once, in `site/astro.config.ts`; `llms.txt`, `llms-full.txt` and the `.md` version of each page are generated from the same pages at build time.

The screenshots come from a made-up setup, never your own. `pnpm --dir site screenshots` builds a throwaway home folder in `/var/tmp/ccdesk-demo`, starts the built ccdesk in it, captures each page in both themes with a headless Chromium, and deletes the folder. It also saves the close crops the landing page's questions open to, and `regions.json`, which records where each scope's rows are in the landing page's screenshot so its route strip can light them up. Run `pnpm build` in the repository first. Set `CHROMIUM_PATH` to use a Chromium you already have, or run `pnpm --dir site exec playwright-core install chromium` once.

The site is deployed to GitHub Pages from `master` by the Pages workflow, which also builds it for every pull request.

## Releases

Releases are made by the Release workflow on GitHub, started by hand from `master` or by a merged Claude Code data pull request. It runs `pnpm check`, then release-it bumps the version from the Conventional Commits since the last tag, or by a patch when none of them is a feature, fix or breaking change (or by the increment you pick), writes `CHANGELOG.md`, commits, tags and creates the GitHub release. The workflow then publishes to npm with trusted publishing, so no npm token is stored. A dry run does everything except push and publish.

Once the package is on npm, the workflow posts a short card to the webhook in the `RELEASE_WEBHOOK_URL` secret: the version, which Claude Code version it tracks and whether that moved, the changelog entry, and what is new in Claude Code since the last release, taken from [its changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md). A Discord webhook gets an embed and a Slack incoming webhook gets a Block Kit message; the URL's host decides which. Without the secret, the card only appears in the run's summary. `pnpm announce discord` (or `slack`) prints the card for the current checkout, so you can pipe it to `curl` and see it in your own channel before a release.

Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages, since they decide the version and the changelog. Only `#` and a number links an issue in the changelog, wherever it appears in a commit; a docs anchor such as `hooks#workspace-trust` stays plain text (`.release-it.ts`).

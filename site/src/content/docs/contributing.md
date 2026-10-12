---
title: Contributing
description: The development loop, the generated Claude Code data, the docs site, and how releases are made.
---

ccdesk is a Node.js server in TypeScript (`src/server`) that serves a React app built with Vite (`src/ui`); `src/shared` holds the types and generated data both use. Tests use `node:test`, linting and formatting use Biome, and packages are managed with pnpm. The source is on [GitHub](https://github.com/ayagmar/ccdesk).

## Development loop

```sh
pnpm install
pnpm dev        # API on 127.0.0.1:4319 with the token "dev"
pnpm dev:ui     # UI with hot reload on port 4320, using the API above
pnpm check      # typecheck, lint, format check, tests, build
```

`pnpm check` is what CI runs on Linux (Node 22 and 24), macOS and Windows. CI also packs the npm package, installs it into an empty folder, starts it in an empty home folder and loads the page, so a file missing from the package fails the build.

Tests never touch your real `~/.claude`. Each test process gets a throwaway home folder, git configuration and environment, network access is blocked, and each test builds its own fixture.

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

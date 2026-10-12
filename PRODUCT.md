# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

TypeScript end to end, published to npm and run with `npx ccdesk`. A small Node server bound to 127.0.0.1 serves a prebuilt React app built with Vite (no Next.js, so startup stays near-instant). Tooling mirrors the author's other packages: pnpm, Biome, TypeScript 7, `node --test`, release-it.

The documentation site in `site/` is a separate workspace package built with Astro and Starlight and deployed to GitHub Pages. It is not part of the npm package.

## Users

Claude Code power users: developers with many projects, memories, skills, subagents, hooks and MCP servers across several directories and agents (Claude Code, Codex, Pi). They open ccdesk to answer "what is Claude actually told here, and where does that come from?" and to fix it. They scan a lot of items quickly and prefer keyboard and density over hand-holding. Teams are a secondary audience: understanding what a repo shares through committed files versus what stays personal.

## Product Purpose

ccdesk is a local config manager for Claude Code. It shows everything that shapes Claude's behaviour on one machine (instruction files, settings, hooks, MCP servers, subagents, skills, plugins and per-directory auto memory), shows where each piece lives and who it is shared with, and lets the user change it safely. Success: a user can answer "why is Claude doing X in this repo?" in seconds and correct the source without hand-editing JSON or hunting through `~/.claude`.

## Positioning

Analytics tools such as cc-tap report what Claude did and what it cost (sessions, tokens, spend). ccdesk reports what Claude is told and lets the user change it:
- the ordered stack of files loaded in a given directory (global, parent folders, project CLAUDE.md/AGENTS.md, local files, auto memory), including whether AGENTS.md is actually imported;
- shared vs private visibility (git status, symlinks into `~/.agents` shared with other agents);
- the value that applies for each setting, with the file it comes from;
- memory upkeep: duplicates across directories, entries missing from the index, broken `[[links]]`.

ccdesk is not a session viewer or an analytics dashboard.

## Operating Context

Runs on the user's own machine against `~/.claude` (or `CLAUDE_CONFIG_DIR`), `~/.claude.json`, and project directories. Used next to a terminal running Claude Code, often while sessions are live, so Claude Code may rewrite files at any moment. Linux, macOS and Windows.

## Capabilities and Constraints

- v0.1: viewer for all of the above, following Claude Code's resolution rules (repo-root local settings, managed drop-ins, scope-limited keys, workspace trust, MCP approvals and precedence, hook switches, plugin defaults, auto memory switches); delete memory with confirmation (also removing its `MEMORY.md` index line and warning about inbound `[[links]]`); schema-driven editing of settings files with the layer-wins view; a permissions view (deny → ask → allow across files, with overridden and not-yet-trusted rules flagged) with per-rule move, remove and add; "What Claude sees" (what loads at session start, with estimated tokens) and a path tester for what loads when Claude touches a file; instruction health checks; one-click `MEMORY.md` fixes with undo; Recent changes with reviewed restore; live refresh from file watching; open any file in the user's editor; memory search across directories; which project files git shares.
- Editing hooks (in settings files), MCP servers and subagent files, including removing a hook or server and deleting an agent, each reviewed and backed up. Deferred: token/cost stats (possibly via llm-usage-metrics).
- Never deletes sessions. ccdesk never writes `~/.claude.json` (Claude Code rewrites it constantly); user and local MCP servers are changed through `claude mcp`, and those changes are not in Recent changes.
- Writes are validated against the settings schema, preview a diff, save exactly the reviewed revision (refusing if the file changed since), preserve keys the user did not touch, write atomically through symlinks and keep a backup with a manifest that Recent changes can restore.
- The settings schema comes from the `Settings` type in `@anthropic-ai/claude-agent-sdk`, which is generated from Claude Code's own settings schema; CI tracks new releases.
- Security: localhost only, per-run token for mutations, no raw HTML from rendered markdown (a cloned repo's AGENTS.md must not be able to run script on a page that can edit settings or hooks). Never reads credentials; redacts `env`/`headers` values.
- Terminology: "memory" = auto memory files under `~/.claude/projects/<dir>/memory`; "instruction files" = CLAUDE.md, CLAUDE.local.md, AGENTS.md; "layers" = user / project / local / managed settings.

## Brand Commitments

Name: ccdesk (lowercase, one word). Command: `npx ccdesk`. No Anthropic marks or implied endorsement.

## Evidence on Hand

A Python prototype at `~/projects/claude-config-viewer` (outside this repo) proved the information architecture against the author's real setup. No users, testimonials or benchmarks exist yet; do not invent them.

## Product Principles

1. Show the source: every value names the file it came from and who can see that file.
2. Safe by default: reads are free; every write is previewed, validated, reversible, and confirmed when destructive.
3. Dense and fast for people with a lot of config: scanning, filtering and keyboard use beat explanation.
4. Local and private: nothing leaves the machine.
5. Follow Claude Code's own concepts and schema rather than inventing parallel ones.

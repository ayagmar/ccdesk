---
title: Skills, commands, output styles and plugins
description: Where ccdesk finds skills, slash commands, output styles and plugins, and which ones are in force.
---

The **Agents, skills & plugins** section lists subagents, skills, commands, output styles and plugins together, each with its scope bullet. The chips beside the title filter by kind. ccdesk shows these but does not edit them; use the open button in the inspector to change a file in your editor. Subagents have [their own page](../subagents/).

## Skills

Skills are folders with a `SKILL.md`. ccdesk reads them from:

- your organisation's managed folder;
- `~/.claude/skills`;
- skills synced from your claude.ai account into `~/.claude/skills/synced`, marked **claude.ai sync**;
- `.claude/skills` in the open directory and every folder above it up to the repository root. In a linked git worktree whose root has no `.claude/skills`, for example because the folder is gitignored, the main checkout's `.claude/skills` is read instead, and the same goes for `.claude/agents`, `.claude/commands` and `.claude/output-styles`, each on its own. The docs name only the first three; Claude Code 2.1.296 also reads output styles through;
- enabled plugins.

Claude Code keeps each claude.ai account's synced skills in their own folder under `~/.claude/skills/synced`, and loads only the folder of the account you are signed in with, which ccdesk reads from `oauthAccount` in `~/.claude.json` (observed in Claude Code 2.1.296; the docs say only that synced skills load in sessions signed in with claude.ai). The others, and every synced skill when you are not signed in that way or `syncClaudeAiSkills` is `false`, are marked as skipped. ccdesk cannot tell how a session signs in, so a session that uses an API key loads none even though they are shown as loaded. A synced skill never takes a name from another skill or command: when one of yours, the project's, a plugin's or a command uses its name, including the folder name that still invokes a skill renamed in its frontmatter, ignoring case, spacing and look-alike forms such as fullwidth letters, the synced skill keeps running under its full name, such as `anthropic-skills:deploy`, and ccdesk shows it under that name. Built-in commands, bundled skills and MCP prompts also take the short name in Claude Code, but ccdesk does not list those.

A plugin's skills and commands are named with the plugin first, such as `my-plugin:review`, so they never clash with yours. When a skill and a command share a name, the skill runs and the command is marked as not used. A skill in a folder below the open directory loads once Claude works on files there, whatever its `paths` say: Claude Code 2.1.296 does not check them for such a skill, and the skills docs do not say either way; when its folder name matches another skill's, the path test names it with its folder, such as `apps/web:deploy`.

Outside plugins, Claude Code skips a skill folder named `synced` in any case, and a skill folder, frontmatter `name`, command file or command subfolder named `anthropic-skills` or starting with `anthropic-skills:`. Like Claude Code 2.1.296, ccdesk compares these names without case, so `Anthropic-Skills` is reserved too, and ignores trailing dots and spaces on a `synced` folder, so `synced.` is skipped. ccdesk marks them as skipped, in the open directory's subfolders too, and never reads a `synced` folder in a skills folder as a plugin. A plugin may use these names.

A skill with `disable-model-invocation` is marked as one that runs only when you call it. The `skillOverrides` setting can turn a skill off, keep it out of the listing Claude sees, or show only its name; ccdesk applies it to user, project and managed skills and to commands. [What Claude sees](../what-claude-sees/) shows the skill listing as Claude gets it.

When managed settings set `strictPluginOnlyCustomization` to `true`, or to a list naming `skills`, Claude Code loads skills only from plugins and the managed folder: your skills, synced ones included, and the project's are marked as skipped and left out of the listing. Command files in `.claude/commands` are skipped too, the managed folder's included: the settings reference says the lock keeps managed sources, but Claude Code 2.1.296 loads no command file while it is on, and ccdesk follows it. Plugin commands still load.

## Commands and output styles

Custom slash commands come from your organisation's managed folder, `~/.claude/commands`, and `.claude/commands` in the open directory and every folder above it up to the repository root. When two share a name, the managed one runs, then yours, then the project folder closest to the open directory, and the others are marked as not used. Output styles come from `~/.claude/output-styles` and the open directory's `.claude/output-styles`. Plugins can add both. Commands in subfolders are named with `:`, such as `frontend:test`.

## Plugins

Installed plugins come from `installed_plugins.json` in the plugins root, which is `~/.claude/plugins` unless `CLAUDE_CODE_PLUGIN_CACHE_DIR` names another folder. A plugin installed for a project applies only in that project and in the worktrees of its repository, where it takes the place of a user install.

A folder in `~/.claude/skills` or in the open directory's `.claude/skills` that holds `.claude-plugin/plugin.json` is a plugin too, listed as `<name>@skills-dir` under the name in its manifest. Parent folders are not searched for these. Its `SKILL.md` stays a skill of the skills folder, as in Claude Code 2.1.296, and is not one of the plugin's skills. Setting `"<name>@skills-dir": false` in `enabledPlugins` turns that skill off too, and setting it back to `true` turns it on again; a plugin that is off for any other reason, such as trust, leaves the skill as it is. A project one loads only once you accept the trust dialog for the open directory's project; trusting a parent folder or running `claude -p` is not enough. Until then it is listed as not loaded. Its MCP servers then wait for the same approval as the project's `.mcp.json`. When two of these share a name, the one in `~/.claude/skills` loads, and an enabled installed plugin of the same name beats both. Managed settings stop all of them when `strictPluginOnlyCustomization` locks any surface, when `strictKnownMarketplaces` lacks the `{ "source": "skills-dir" }` entry, or when `blockedMarketplaces` has it. The settings reference says an allowlist stops only the ones in `~/.claude/skills`, but Claude Code 2.1.296 drops the project's ones as well, and so does ccdesk.

Some plugin sources and rules are not covered:

- Plugins synced from your claude.ai account (`<name>@synced`) are not listed.
- Session-only plugins from `--plugin-dir`, `--plugin-url` or `CLAUDE_CODE_PLUGIN_DIRS` (`<name>@inline`) are not listed.
- A folder in `~/.claude/skills` that the skills sync claims in its `manifest.json` is not a plugin in Claude Code; ccdesk still lists it as one.
- In a session with `CLAUDE_CODE_RESTRICT_PERSONAL_CONFIG`, Claude Code loads the folders in `~/.claude/skills` as skills only; ccdesk still lists them as plugins.
- For a project skills-dir plugin, Claude Code skips MCP servers declared as an MCP bundle (`.mcpb` or `.dxt`); ccdesk does not.
- ccdesk does not list plugin monitors, so it does not show that a project skills-dir plugin's monitors do not load.
- ccdesk counts only an enabled installed plugin as taking a skills-dir plugin's name; whether a turned-off one does too is not confirmed.

A plugin is on or off according to the highest settings file that lists it in `enabledPlugins`; with no entry, the `defaultEnabled` of the plugin's marketplace entry decides, then its own manifest's, and plugins are on by default. A plugin that is off is dimmed and contributes nothing. An enabled plugin can add skills, commands, subagents, output styles, hooks and MCP servers, each listed in its own section with the **X** bullet, and the route strip gains a Plugin stop. A manifest that sets `commands`, `agents` or `outputStyles` replaces the plugin's default folder for it, and `commands` may be a map of names to a file or inline text, which replaces the folder too; `skills` adds to the `skills` folder. The plugins reference says `agents` entries must be `.md` files, but Claude Code 2.1.296 also loads a folder named there, and so does ccdesk.

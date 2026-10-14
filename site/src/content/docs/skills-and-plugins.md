---
title: Skills, commands, output styles and plugins
description: Where ccdesk finds skills, slash commands, output styles and plugins, and which ones are in force.
---

The **Agents, skills & plugins** section lists subagents, skills, commands, output styles and plugins together, each with its scope bullet. The chips beside the title filter by kind. ccdesk shows these but does not edit them; use the open button in the inspector to change a file in your editor. Subagents have [their own page](../subagents/).

## Skills

Skills are folders with a `SKILL.md`. ccdesk reads them from:

- your organisation's managed folder;
- `~/.claude/skills`, including skills synced into `~/.claude/skills/synced`;
- `.claude/skills` in the open directory and every folder above it up to the repository root;
- enabled plugins.

A plugin's skills and commands are named with the plugin first, such as `my-plugin:review`, so they never clash with yours. When a skill and a command share a name, the skill runs and the command is marked as not used. A skill in a folder below the open directory loads once Claude works on files there, whatever its `paths` say: Claude Code 2.1.296 does not check them for such a skill, and the skills docs do not say either way; when its folder name matches another skill's, the path test names it with its folder, such as `apps/web:deploy`.

A skill with `disable-model-invocation` is marked as one that runs only when you call it. The `skillOverrides` setting can turn a skill off, keep it out of the listing Claude sees, or show only its name; ccdesk applies it to user, project and managed skills and to commands. [What Claude sees](../what-claude-sees/) shows the skill listing as Claude gets it.

When managed settings set `strictPluginOnlyCustomization` to `true`, or to a list naming `skills`, Claude Code loads skills and commands only from plugins and the managed folder: your skills and commands, synced ones included, and the project's are marked as skipped and left out of the listing.

## Commands and output styles

Custom slash commands come from `~/.claude/commands` and the open directory's `.claude/commands`; output styles from `~/.claude/output-styles` and the open directory's `.claude/output-styles`. Plugins can add both. Commands in subfolders are named with `:`, such as `frontend:test`.

## Plugins

Installed plugins come from `~/.claude/plugins/installed_plugins.json`. A plugin installed for a project applies only in that project, where it takes the place of a user install.

A plugin is on or off according to the highest settings file that lists it in `enabledPlugins`; with no entry, its own manifest decides, and plugins are on by default. A plugin that is off is dimmed and contributes nothing. An enabled plugin can add skills, commands, subagents, output styles, hooks and MCP servers, each listed in its own section with the **X** bullet, and the route strip gains a Plugin stop.

---
title: Subagents
description: The subagents available in a directory, which definition wins, and how to create, change or delete an agent file.
---

Subagents are listed in the **Agents, skills & plugins** section with the kind **agent**. ccdesk reads them from:

1. your organisation's managed folder;
2. `.claude/agents` in the open directory and every folder above it up to the repository root, the closest first;
3. `~/.claude/agents`;
4. enabled plugins, named `plugin:agent`.

Subfolders are read too. When two files define an agent with the same name, the higher one wins and the other is marked as shadowed. Select an agent to read its file.

## Creating an agent

**Create agent** writes a new Markdown file:

- **Project** puts it in the repository's `.claude/agents` (the open directory's, outside git), where everyone who clones gets it once it is committed.
- **User** puts it in `~/.claude/agents`, for you in every project.

Give it a file name (letters, digits, `.`, `_` and `-`; ccdesk adds `.md` if you leave it off) and the file's contents. The frontmatter needs a `name` and a `description`, as Claude Code requires. The name cannot contain `:` or start with `-`, and is at most 256 characters long.

```md
---
name: reviewer
description: Reviews a diff for correctness and missing tests before you commit.
tools: Read, Grep, Glob, Bash
---

You review the staged diff. List real defects first, then risky changes, then nits.
```

## Changing and deleting

Select a user or project agent to edit its file or delete it. Each change shows the diff first and is backed up, so a deleted agent can be restored from [Recent changes](../recent-changes/). If the file changed after you reviewed the edit, ccdesk refuses and asks you to review again.

Plugin agents are changed in the plugin, and managed agents by your organisation.

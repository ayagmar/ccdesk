---
version: 1
slug: "src-ui-app-tsx"
primary_target: "src/ui/App.tsx"
related_targets: []
---

# ccdesk app shell

Scope: the whole local web app (one surface, Operate mode). Audience: Claude Code power users scanning lots of config. Job: answer "what is Claude told in this directory, from which file, and who can see it", then fix it (delete memory; later edit settings). Landing: the directory `ccdesk` was launched from; overview one click away. Must not feel like a generic dev dashboard, must not be sparse, must be fully keyboard-drivable, must always expose the raw file and its path.

## Direction contract

THESIS: Every directory is a line. Config loads stop by stop (Managed → User → parent dirs → Project → Local → Memory) and every value, file and memory carries the route bullet of the scope it came from. Refuses the category default of a sidebar + stat cards + tabs where provenance is an afterthought.

OWN-WORLD: Swiss timetable print on the light theme (paper white ground, near-black ink, hairline rules), departure-board dark theme (deep blue-black board, warm white type). Scope line colours, flat and unmodulated, colour-blind safe and always paired with a letter bullet: M managed (vermilion), U user (blue), P project (bluish green), L local (orange), A auto memory (reddish purple). Workhorse grotesk for UI, tabular monospace for keys, paths and counts aligned to the character. Equal-height timetable rows on one row grid.

STORY: Visitor opens ccdesk from a repo, sees that repo's line drawn across the top, reads which files load and which are skipped (and why), scans the timetable of everything that applies, opens the raw file in the inspector, and acts (delete a stale memory with undo).

FIRST VIEWPORT: Left rail (~240px): directory picker with the launch dir pinned, then projects with history, filter box, counts in mono. Top band: the route strip for the current directory, stops left to right with bullets and counts, skipped stops drawn hollow. Main column: timetable sections (Instructions, Settings, Memory, Hooks, MCP, Agents & Skills) with sticky column headers: line bullet · name · value/summary · file · visibility. Right inspector (~420px): selected item's raw file with path, symlink target, git visibility, and actions. ⌘K command palette; j/k row movement; / to filter.

FORM: Swiss rail timetable and route strip map, position 3 of the grounded list, seed key 64811e85. Signature interaction: route strip and timetable are one space (click a stop to jump to its rows; selecting a row lights its stop). Raises kept: tabular mono alignment (Ikeda), whole-row grid (Crouwel), registered layer columns in settings compare (folio), map↔list deep links (doujin), flat colour commitment (zoo).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

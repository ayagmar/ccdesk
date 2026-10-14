---
name: ccdesk
description: A local config manager for Claude Code, set as a Swiss rail timetable with a route-strip line map.
colors:
  ink: "#141414"
  ink-2: "#4a4a45"
  muted: "#6b6a63"
  paper: "#fbfbf7"
  panel: "#ffffff"
  sunk: "#f1f0ea"
  hover: "#f4f3ec"
  rule: "#dcdad1"
  selection: "#fff3c4"
  focus: "#0072b2"
  ok: "#1d6b47"
  warn: "#8a5a00"
  warn-bg: "#fff1d6"
  bad: "#a3361c"
  bad-bg: "#fde7e0"
  line-managed: "#b84f00"
  line-user: "#0072b2"
  line-project: "#007a5a"
  line-local: "#e69f00"
  line-memory: "#cc79a7"
  line-plugin: "#5f5f5a"
  board: "#131312"
  board-panel: "#1a1a18"
  board-sunk: "#222220"
  board-hover: "#1d1d1b"
  board-rule: "#2c2b28"
  board-ink: "#ece8de"
  board-ink-2: "#c7c2b6"
  board-muted: "#938f84"
  board-selection: "#33302a"
  board-selection-ink: "#fff6e0"
  board-focus: "#f2c14e"
  board-ok: "#6fcf97"
  board-warn-bg: "#2b2512"
  board-bad: "#ff8a73"
  board-bad-bg: "#371b15"
  board-line-managed: "#ff7a3d"
  board-line-user: "#4aa8e8"
  board-line-project: "#2fbf8f"
  board-line-local: "#f2b233"
  board-line-memory: "#e391bd"
  board-line-plugin: "#8d95a5"
typography:
  display:
    fontFamily: "Hanken Grotesk Variable, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "JetBrains Mono Variable, ui-monospace, Menlo, Consolas, monospace"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Hanken Grotesk Variable, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "-0.005em"
  body:
    fontFamily: "Hanken Grotesk Variable, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  prose:
    fontFamily: "Hanken Grotesk Variable, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Hanken Grotesk Variable, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.45
  mono:
    fontFamily: "JetBrains Mono Variable, ui-monospace, Menlo, Consolas, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.45
  mono-count:
    fontFamily: "JetBrains Mono Variable, ui-monospace, Menlo, Consolas, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.45
  bullet:
    fontFamily: "Hanken Grotesk Variable, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "11.5px"
    fontWeight: 700
    lineHeight: 1
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "10px"
  pill: "999px"
spacing:
  row: "32px"
  control: "30px"
  gutter: "28px"
  gutter-narrow: "16px"
  section: "26px"
  rail: "248px"
  inspector: "clamp(440px, 30vw, 600px)"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    height: "30px"
    padding: "0 12px"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "30px"
    padding: "0 12px"
  button-danger:
    backgroundColor: "{colors.bad}"
    textColor: "{colors.panel}"
    rounded: "{rounded.md}"
    height: "30px"
    padding: "0 12px"
  button-quiet-danger:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.bad}"
    rounded: "{rounded.md}"
    height: "30px"
    padding: "0 10px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    size: "28px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "6px 8px"
  filter-box:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    height: "30px"
    padding: "0 8px"
  segmented-option:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    height: "24px"
    padding: "0 9px"
  segmented-option-on:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  rail-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "30px"
    padding: "0 8px"
  rail-item-current:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  timetable-row:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    height: "{spacing.row}"
    padding: "0 8px"
  timetable-row-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.ink}"
  bullet:
    typography: "{typography.bullet}"
    rounded: "{rounded.pill}"
    size: "22px"
  bullet-table:
    rounded: "{rounded.pill}"
    size: "20px"
  flag:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sm}"
    height: "18px"
    padding: "0 6px"
  flag-warn:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.warn}"
  flag-bad:
    backgroundColor: "{colors.bad-bg}"
    textColor: "{colors.bad}"
  raw-file:
    backgroundColor: "{colors.sunk}"
    typography: "{typography.mono}"
    rounded: "{rounded.md}"
    padding: "12px"
  palette:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.xl}"
    width: "640px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "8px 8px 8px 14px"
---

# Design System: ccdesk

## Overview

**Creative North Star: "The Timetable & Line Map"**

Every directory is a rail line. Claude Code loads its configuration stop by stop, Managed, User, Project, Local, Auto memory (and Plugin when one is enabled), and ccdesk draws that order as a route strip across the top of the screen, then lists everything that applies as a printed timetable underneath. Every file, setting and memory carries the route bullet of the stop it came from, so provenance is the first thing you read on a row, not a detail you go looking for.

The light theme is Swiss timetable print: warm paper white, near-black ink, hairline rules and heavy two-pixel section rules. The dark theme is a departure board at night: matte graphite board, warm white type, the same scope lines brightened to read against it. Both themes are dense and flat. Rows sit on one 32px grid, counts and paths are set in a tabular monospace that aligns to the character, and colour is reserved for the scope lines and a small set of state inks.

The interface is built for people with a lot of config who scan rather than read: a rail of directories on the left, the route strip and timetable in the middle, the inspector with the raw file on the right, and a command palette over everything.

**Key Characteristics:**
- Route bullets (a letter in a flat colour circle) on every row, every stop and every layer.
- One 32px row grid shared by timetables and palette results.
- Grotesk for the interface, tabular monospace for keys, paths, values and counts.
- Flat surfaces; heavy ink rules divide sections, hairlines divide rows.
- Two themes from one token set: timetable paper (light) and departure board (dark).

**Mascot.** Murmeli (Swiss German for marmot) is the station master of the line: an upright Alpine marmot in clay fur and a cream belly, wearing a near-black conductor cap and a whistle, because marmots stand watch and whistle when something is wrong, which is what ccdesk does for your config. The logo is his head in a near-black badge with a clay ring (`assets/brand/logo.png`; the app serves a 128px copy as its icon). The README banners (`assets/brand/banner-light.webp`, `banner-dark.webp`) put him at a station desk beside a line of five stops in the scope colours. The generated originals are in `assets/brand/source/`. He stays out of the working interface beyond the rail badge.

## Colors

A neutral print palette in two lighting conditions, with six flat scope-line colours drawn from the Okabe–Ito colour-blind-safe set (managed is darkened from vermilion toward burnt orange so it holds contrast on paper).

### Primary
- **Timetable Ink** (ink): the text colour, the heavy section rule, the route line itself, and the fill of every primary or "on" control (primary button, current rail item, pressed segment). On the board it becomes **Warm Board White** (board-ink).

### Scope Lines
- **Managed** (line-managed, letter M): settings and instructions pushed by an administrator.
- **User** (line-user, letter U): the user's own `~/.claude` files.
- **Project** (line-project, letter P): files committed in the repository.
- **Local** (line-local, letter L): personal per-project files that stay out of git.
- **Auto memory** (line-memory, letter A): memory files Claude writes per directory.
- **Plugin** (line-plugin, letter X): a deliberately neutral grey; plugins are a source, not a layer of the load order.

Each line has a matching "on" ink for its bullet letter: white on Managed, User, Project and Plugin, Timetable Ink on Local and Auto memory in light; Board ground on all brightened lines in dark.

### State
- **Loaded / Committed Green** (ok): "loaded" status and "committed" visibility text, diff additions at 16% tint.
- **Untracked Amber** (warn, warn-bg): "untracked" visibility, warning flags.
- **Fault Red** (bad, bad-bg): destructive actions, "not in index" style faults, diff removals at 16% tint, the delete confirmation box.
- **Focus Blue** (focus): focus rings and links on paper; **Board Lamp Yellow** (board-focus) on the board.

### Neutral
- **Timetable Paper** (paper): the page ground and sticky header ground. **Board** (board) in dark.
- **Panel White** (panel): rail, inspector, palette and secondary buttons.
- **Sunk Paper** (sunk): raw file and diff wells, the pressed route stop, neutral flags.
- **Hover Paper** (hover): row and control hover.
- **Hairline** (rule): row dividers, control borders, column-head underlines on paper.
- **Second Ink** (ink-2): values, "why" text and descriptions. **Muted** (muted): column heads, counts, skipped rows, placeholders.
- **Selection Cream** (selection): the selected timetable row and the active palette option. On the board it is **Board Selection Umber** (board-selection) with **Selection White** ink.

### Named Rules
**The Line Colour Rule.** A scope-line colour means "this came from that scope" and nothing else. It appears only inside a bullet, on the route strip, or on the line map of the README banner; never as a heading colour, a button fill or a chart series.

**The Letter Rule.** A scope colour is never shown without its letter (M, U, P, L, A, X). Colour is the second channel; the letter is the one a colour-blind reader relies on.

**The State Words Rule.** State inks (ok, warn, bad) colour a word that already says the state ("loaded", "untracked", "1 broken link"). They never stand alone as a dot or swatch.

## Typography

**Display Font:** Hanken Grotesk Variable (with Helvetica Neue, Helvetica, Nimbus Sans, Liberation Sans, Arial)
**Label/Mono Font:** JetBrains Mono Variable (with ui-monospace, SF Mono, Menlo, Consolas, Liberation Mono)

Both are bundled through `@fontsource-variable`, so the app never depends on a network font or the system face.

**Character:** a plain, workhorse grotesk that behaves like timetable print, paired with a monospace that keeps paths, keys and numbers aligned to the character. Tabular numerals are on for the whole document.

### Hierarchy
- **Display** (700, 22px, -0.015em): page titles on full pages such as All directories.
- **Headline** (mono 700, 19px, -0.01em): the current directory path at the top of the workspace. The path is the title, so it is set in mono. Its end names the directory, so a path too long for its row loses its start ("…/services/billing-worker"), with the whole path in its tooltip; the flags beside it give way only once the path is down to 16 characters. On phones it wraps instead.
- **Title** (700, 15px; 16px in the inspector head; 13px for inspector sub-heads): timetable section names (Instructions, Settings, Permissions, Memory, Hooks, MCP servers, Agents, skills & plugins, All settings) and the selected item's name.
- **Body** (400, 14px, 1.45): interface text, timetable cells, the "why" column.
- **Prose** (400, 13.5px, 1.6, max 68ch): rendered markdown of instruction and memory files in the inspector; headings inside it stay at 14px so a file's own h1 never outshouts the interface.
- **Label** (600, 12px, muted): column heads and rail group names, in sentence case.
- **Mono** (12.5px): file paths, setting keys and values, hook commands, raw file contents. **Mono count** (11.5–12px, muted): section counts, rail counts, stop facts, line counts, relative times.
- **Bullet** (700, 11.5px; 10.5px at table size): the scope letter inside a route bullet.

### Named Rules
**The Character Grid Rule.** Anything a user might compare across rows, a path, key, value, count or time, is set in mono with tabular figures so it lines up column by column.

**The Sentence Case Rule.** Headings, column heads and group labels are sentence case at their natural tracking. Hierarchy comes from weight and the rules above them, not from capitals or letter-spacing.

## Layout

The shell is a three-column grid: the directory rail (248px), the main column, and the inspector (440px, growing to 30% of the window up to 600px). The main column scrolls on its own with a 28px gutter and carries, top to bottom, a sticky directory header (the path with the Config / What Claude sees switch, row filter and palette button beside it, then the section index with its 1–9 keys, which drops the key hints and then the counts when the column is narrow so it stays on one line), the route strip (stops with nothing to contribute take half the width), and the timetable sections spaced 26px apart.

Timetable rows are exactly one row unit (32px) tall, with 8px cell padding, single-line cells that truncate with an ellipsis, and fixed column widths per table so the bullet, name and file columns land in the same place from section to section. Column heads (26px) stick directly under the sticky directory header, so a section's columns stay labelled while you scroll it. The header is 92px tall; in a main column narrower than 960px the tools move to a row of their own under the path and it grows to 130px, so the path keeps the column's width. The palette's results use the same 32px row.

Responsive behaviour is three window steps, plus column drops keyed to the main column's own width (a container query), since the inspector takes room at any window size. Below 880px of main column, Built-in tools drops its Description column, which the inspector shows.
- **1181–1400px:** the rail narrows to 220px and the inspector to 360px; the Instructions "Lines" column is dropped because the inspector already shows it.
- **≤1180px:** the inspector leaves the grid and slides over from the right edge as a drawer when a row is selected; with nothing selected it is hidden.
- **≤760px:** the rail stacks above the content (capped at 34% of the viewport), gutters shrink to 16px, the palette button is hidden in favour of the keyboard shortcut, the route strip turns vertical with the line running down the left, each table keeps only the columns that answer "is it loaded, and who sees it", and column heads stop sticking because the header height varies.

### Named Rules
**The One Row Rule.** Every list row is 32px. A new list joins this grid; it does not invent a taller card row.

**The Inspector Repeats Rule.** When space runs out, a column may be dropped only if the inspector shows the same fact for the selected row.

## Elevation & Depth

The system is flat. Depth at rest comes from tone (paper, panel, sunk) and from rules: a 2px ink rule opens every section, the route strip and the inspector head; 1px hairlines separate rows and controls. Shadows exist only on things that float above the page.

### Shadow Vocabulary
- **Palette lift** (`box-shadow: 0 18px 48px -12px rgb(0 0 0 / 0.35)`): the command palette over a 55% paper scrim.
- **Toast lift** (`box-shadow: 0 12px 32px -10px rgb(0 0 0 / 0.4)`): the undo toast at the bottom centre.
- **Drawer edge** (`box-shadow: -16px 0 40px -16px rgb(0 0 0 / 0.35)`): the inspector when it becomes a drawer at 1180px and below.
- **Lit stop ring** (`box-shadow: 0 0 0 2px paper, 0 0 0 4px ink`): a paper gap and an ink ring around the route-strip bullet whose scope the selected row belongs to. This is a highlight, not elevation.

### Named Rules
**The Floating-Only Shadow Rule.** A shadow means "this sits above the page and will go away" (palette, toast, drawer). Anything that lives in the layout is flat and separated by rules.

## Shapes

Corners are small and functional: 6px on every control, row hover and well; 4px on flags, keycaps and list options; 8px on the toast and delete confirmation; 10px on the command palette. Route bullets and their stop nodes are full circles. Timetable rows and sections have no radius at all; they are print, bounded by rules.

Memory types are told apart by ink shapes, 8px, in the second ink: a circle for user, a triangle for feedback, a square for project, a diamond for reference, and a hollow outlined square for unknown.

Icons are a small drawn set on a 16px grid with a 1.5px round-capped stroke in the current text colour.

### Named Rules
**The Shape Not Colour Rule.** Any category that is not a scope (memory type, for example) is distinguished by shape in ink, so colour keeps meaning scope lines only.

## Components

### Route Strip (signature)
The directory drawn as a line. A 3px ink line runs through a row of equal-width stops, one per scope in load order, under a 2px ink rule and over a hairline.
- **Stop:** a 22px bullet on a paper node, the scope name (700, 13.5px), and mono facts underneath ("2 files · 3 settings · 1 more" or "nothing here").
- **Idle stop:** a scope that contributes nothing gets a hollow bullet (paper fill, coloured letter and ring) and a muted, lighter name.
- **Unreadable file:** a stop whose settings file ccdesk could not read is not idle, whatever else it contributes: it keeps a solid bullet and carries a warn flag ("1 file can't be read"), so the strip never calls a scope unused while the problems strip above names its broken file.
- **Lit:** selecting a timetable row rings the bullet of that row's scope.
- **Filter:** clicking a stop filters the timetable to that scope; the pressed stop gets a sunk background and an underlined name. Clicking it again shows every scope.
- **Narrow screens:** the strip turns vertical with the line running down the left.

### Bullets
A circle with the scope letter, filled with the line colour and lettered in its "on" ink, 22px on the route strip and 20px in tables, the palette and the layer list. A hollow bullet marks a scope that is present but not in force (skipped file, idle stop, losing layer); on the two light lines, Local and Auto memory, its letter is set in ink because the line colour is too pale for an 11px letter on paper. Several bullets in one cell (a setting merged from User and Project) sit 3px apart.

### Timetable
- **Section head:** 2px ink rule, title, mono count, optional segmented filter or head action, and inline warning flags.
- **Rows:** 32px, hairline below, hover in hover paper, selected in selection cream with the name in bold, skipped rows in muted ink.
- **Beaten values:** in Settings, values that lost to a higher layer are shown struck through with their own bullet, so the winner and the losers read on one line.
- **Status and visibility:** coloured words ("loaded", "on match", "skipped"; "tracked in git", "untracked"; "asks first", "runs without asking", "removed"), never bare swatches.
- **Sorting and paging:** sortable column heads are plain buttons with an arrow mark that cycle ascending, descending, off and set `aria-sort`; the facet chips show "x of y" when narrowed and scroll sideways rather than squeeze their labels when they do not fit; a facet with more than 8 values becomes a select with the counts in its options. Sections longer than 50 rows end in a "Show 50 more · x of y shown" text button, never page numbers.
- **Empty section:** the heading stays, followed by a muted sentence naming what is absent.
- **Fix beside the fault:** a fault that ccdesk can repair (a memory missing from `MEMORY.md`, index lines for deleted files) carries a small outlined button right after its flag. The button opens the diff review in place (in the section head, the review takes a full row), and the saved change is reversible from the toast.
- **Permission lists:** "allow", "ask" and "deny" are coloured words in the ok, warn and fault inks; an allow rule that a deny or ask rule overrides is dimmed and carries a warn flag naming the rule that wins. The section head carries an "Add rule" head action. Suggested rules, from calls you allowed by hand, follow the rules from files: no bullet, a muted "suggested" in the list column, and the count with a muted relative time as the outcome; they have their own facet chip. A rule that covered no counted call carries a neutral "covered no call here" flag.
- **Counts:** numeric columns (such as Used in Built-in tools) are right-aligned mono; a zero stays muted and a real count is set in ink, so the eye lands on what was used.
- **Not in force:** a row Claude Code does not apply (an ignored setting, a rule waiting for workspace trust, a hook switched off, an MCP server waiting for approval or overridden, a plugin that is off) is dimmed and carries a warn flag or status word saying why; the full reason is the flag's title and the inspector's verdict.
- **Health checks:** an instruction file with checks carries a warn flag with the count after its name; the inspector lists each check under the verdict.

### What Claude Sees
The alternative to the timetable for one directory: a summary sentence with the estimated token total, then the load order drawn as one segmented bar, each file a segment in its scope colour and as long as its share. Below it, a numbered list of 32px rows (number, bullet, path with an "imported by" note, lines, estimated tokens, running total) that each expand into the raw text in a sunk mono well. An import ccdesk will not read, or one waiting for approval, gets a hollow bullet, "not counted" and no counts, and so do labelled rows for what ccdesk cannot measure (the system prompt, MCP tool names). Listings ccdesk assembles (skill listing, subagent descriptions) are labelled in the body font rather than shown as paths.

Below the list, **When Claude touches a file** sits under a hairline: a heading, one muted sentence, a mono path input with a Check button, and result rows of bullet, muted kind ("path rule", "skill", "folder instructions"), mono name and a muted "matches <glob>".

### Recent Changes
A page reached from the rail. Each change is a row on a hairline: bold kind ("Settings changed", "Memory deleted"), mono file path, muted relative time, and a "Review restore" head action. The row opens into the same diff review as the setting editor, with "Restore this version" as the primary button, or a warn flag when the restore is blocked. On phones the row stacks: kind and time, then path, then the action.

### Problems Strip
Above the route strip when ccdesk could not parse a settings file or `.mcp.json`: an amber-tinted box with a warn icon and one line per file (mono path, the parser's message). When the folder is not yet trusted in Claude Code, a "not trusted yet" warn flag sits beside the directory title.

### Sharing Strip
Under the route strip, when the directory is in git: up to three label-and-files groups on one wrapping line, labels in the visibility inks (committed green, untracked amber, ignored muted), file names in mono.

### Inspector
A panel-white column with a sticky head (bullet, item name, close) closed by a 2px ink rule. Below it: a one-line verdict, a two-column fact list (104px muted terms, mono values with a copy button), the layer list for settings (winning layer bold, losing layers struck through, unset layers muted), imports, and the contents bar with a Read/Raw segmented switch over the rendered prose or the raw file in a sunk mono well. Actions sit at the end: a quiet danger button for delete, which opens an inline confirmation box in fault red tint.

### Setting Editor and Diff Review
Editing happens inside the inspector. A segmented control picks the target layer by bullet, the file path is shown in mono, and the field matches the setting's schema type: text, number, select, checkbox, one entry per line in a textarea that does not wrap, a toggle button per value for lists the schema limits, or an indented group with a labelled field per property for objects, each property's description cut to its first sentence with the rest behind a disclosure. Anything else is a JSON textarea with a muted line saying what shape it takes, and an "Edit as JSON" / "Edit in form" button switches between the two. An `autoMode` list without `"$defaults"`, empty ones included, gets a warning flag that names `claude auto-mode defaults`, under its field with a "Keep built-in entries" button in the form, or under the textarea in JSON. "Review change" shows a unified diff in a sunk mono well: additions tinted green, removals tinted red and struck through, unchanged context muted and long unchanged runs collapsed into an italic "… n unchanged lines". Save and Cancel follow the diff, with a muted note that the old file is backed up first.

### Buttons
- **Shape:** gently rounded (6px), 30px tall, 13px text.
- **Primary:** ink fill, paper text, 600 weight. One per action group (Review change, Save).
- **Secondary:** panel fill, hairline border; the border darkens to second ink on hover.
- **Danger:** fault red fill, used only inside the delete confirmation. **Quiet danger:** panel fill, hairline border, fault red text and icon; the border turns red on hover.
- **Icon button:** 28px (22px small), no border, muted icon; hover paper and ink on hover.
- **Disabled:** 60% opacity with a progress cursor while a write is in flight.

### Inputs / Fields
- **Style:** paper fill, hairline border, 6px radius, 30px (filters) or 32px (editor fields) tall. Filter boxes carry a leading search icon and a trailing keycap hint.
- **Focus:** filter boxes turn their border focus-blue; editor fields get a 2px focus outline. Everything else uses the global 2px focus-visible outline offset by 2px. Inside anything that scrolls sideways (segmented controls, the section index) the ring is drawn 2px inside the option instead, because the scroll box would clip it; on a pressed option a 1px paper line separates the ring from the ink fill.
- **Keycaps:** mono 11px, hairline border with a 2px bottom edge, 4px radius.

### Chips and Segmented Controls
- **Flags:** 18px tall, 4px radius, 11.5px text with an optional 13px icon; neutral (sunk), warning (amber) or fault (red).
- **Segmented control:** joined options with hairline dividers and a 6px outer radius; the pressed option fills with ink. Used for memory-type filters (with the type shapes), Read/Raw, and layer choice (with bullets).

### Navigation
- **Rail:** panel white with a hairline right edge. The brand mark is Murmeli's badge at 26px beside "ccdesk" in 700. "All directories" and "Recent changes" sit under it as icon links. Groups ("Opened from", "Used with Claude") are 12px muted labels. Items are 30px, 13.5px, with a mono count on the right; hover in hover paper; the current directory is inverted (ink fill, paper text); a directory that no longer exists is struck through.
- **Command palette:** opened with Ctrl/⌘K over a paper scrim, 640px wide with a 46px input and 32px result rows, each led by a bullet; the active option is selection cream. It rises 6px into place over 180ms.
- **Keyboard:** j/k move between rows and move focus with them, / focuses the row filter, Ctrl/⌘K opens the palette.

### Toast and Loading
- **Toast:** an inverted (ink) bar with 8px corners at the bottom centre carrying the result of a destructive action and an Undo button.
- **Loading:** a 220×3px line with an ink segment travelling along it, the route line in motion.

### Docs Site
The documentation site (`site/`, Astro Starlight) uses the same two themes, fonts and scope-line colours, mapped onto Starlight's variables in `site/src/styles/theme.css`. Like the app it starts on the system theme, with Starlight's switch to change it. Headings stand on the 2px ink rule and the current sidebar page is inverted like the rail. The landing page opens with a working route strip and real screenshots taken from a made-up setup in both themes. Pointing at or pressing a stop shows the files that scope contributes and lights up its rows in the screenshot below: the rest of the shot dims under paper and each row gets a ring in the line colour. Each question in the questions table opens to a close crop of the rows that answer it. Murmeli's badge is the site logo and favicon. Motion follows the app's rule: the hero screenshot is uncovered left to right as the route line draws, a stop's files board in turn when you switch stops, a question's answer unrolls downwards, and a screenshot grows from its place into a full-window viewer and shrinks back on close. Under reduced motion these become fades.

## Do's and Don'ts

### Do:
- **Do** put a route bullet at the start of every row, stop and layer that comes from a scope, and use the hollow bullet for "present but not in force".
- **Do** keep every list row at 32px and set paths, keys, values, counts and times in mono with tabular figures.
- **Do** open sections with the 2px ink rule and separate rows with hairlines.
- **Do** tell non-scope categories apart by ink shape, as memory types do.
- **Do** show the source file path, in mono and copyable, for anything the inspector shows.
- **Do** preview every write as a diff before the Save button appears.
- **Do** let motion stay short (160–220ms, `cubic-bezier(0.16, 1, 0.3, 1)`) and switch it off entirely under reduced motion.

### Don't:
- **Don't** use a scope-line colour for anything other than its scope, or show one without its letter.
- **Don't** use colour to separate memory types or other non-scope categories.
- **Don't** add shadows to anything that lives in the layout; shadows are for the palette, toast and drawer only.
- **Don't** put radius on timetable rows or sections, or turn rows into cards.
- **Don't** use uppercase tracked labels or small caption lines above headings; headings stand on their rule.
- **Don't** add icons that are text glyphs or emoji; use the drawn 16px icon set.

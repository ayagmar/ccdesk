import { basename, join } from "node:path";
import {
  type ContextBlock,
  type EffectiveSetting,
  type Entry,
  type ImportRef,
  type Instruction,
  type Inventory,
  type MemoryStore,
} from "../../shared/types.ts";
import { type ScanEnv } from "./env.ts";
import { isWithin, readTextFile, resolvedPath } from "./files.ts";
import { parseFrontmatter } from "./data.ts";

/**
 * Imports can name any file, so a cloned repo's CLAUDE.md could point at private files.
 * ccdesk shows an import's text only from the project, your Claude folders and ~/.agents.
 */
function showable(env: ScanEnv, projectRoot: string, path: string): boolean {
  if (basename(path) === ".credentials.json") return false;
  return [projectRoot, env.claudeDir, join(env.home, ".agents"), env.managedDir].some((root) =>
    isWithin(root, path)
  );
}

/** What Claude Code injects from an instruction file: no frontmatter, no block-level HTML comments. */
function injectedText(text: string): string {
  const body = parseFrontmatter(text).body;
  // Comments inside code fences are kept, so only text outside fences is stripped.
  return body
    .split(/(^(?:```|~~~)[\s\S]*?^(?:```|~~~)[^\n]*$)/m)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*\n?/gm, "")))
    .join("");
}

function block(
  fields: Omit<ContextBlock, "lines" | "bytes" | "text">,
  text: string | null
): ContextBlock {
  return {
    ...fields,
    text,
    lines: text === null || text === "" ? 0 : text.split("\n").length,
    bytes: text === null ? 0 : Buffer.byteLength(text, "utf8"),
  };
}

/** Claude Code caps each skill's description and when_to_use at this many characters in its listing. */
const SKILL_DESCRIPTION_CAP = 1536;
const BUILT_IN_STYLES = ["default", "explanatory", "learning"];

/** Skills and command files Claude can pick on its own; skillOverrides "name-only" drops the description. */
function skillListing(skills: Entry[]): string {
  return skills
    .map((s) => {
      const name = s.id ?? s.name;
      if (s.override === "name-only") return `- ${name}`;
      const text = [s.description, s.whenToUse].filter(Boolean).join(" ");
      return `- ${name}: ${text.slice(0, SKILL_DESCRIPTION_CAP)}`;
    })
    .join("\n");
}

/** The scope a listing shows: the one its entries share, else user. */
function commonScope(entries: Entry[]): ContextBlock["scope"] {
  const first = entries[0]?.scope ?? "user";
  return entries.every((e) => e.scope === first) ? first : "user";
}

interface ContextInput {
  env: ScanEnv;
  projectRoot: string;
  instructions: Instruction[];
  memory: MemoryStore | null;
  inventory: Inventory;
  effective: EffectiveSetting[];
}

/** What Claude Code puts in context at session start in this directory, in load order. */
export async function buildContext(input: ContextInput): Promise<ContextBlock[]> {
  const { env, projectRoot, instructions, memory, inventory, effective } = input;
  const blocks: ContextBlock[] = [
    block(
      {
        kind: "not-counted",
        path: "Claude Code's system prompt and built-in tools",
        scope: "managed",
        note: "Part of every session; their size depends on your Claude Code version and model",
      },
      null
    ),
  ];
  const style = outputStyleBlock(effective, inventory);
  if (style) blocks.push(style);
  blocks.push(...(await instructionBlocks(env, projectRoot, instructions)));
  const index = memory?.index;
  if (memory?.loaded && index) {
    blocks.push(
      block(
        { kind: "memory-index", path: index.path, scope: "memory" },
        index.text.split("\n").slice(0, index.loadedLines).join("\n")
      )
    );
  }
  blocks.push(...listingBlocks(inventory));
  return blocks;
}

/** The output style's text, when outputStyle names one that is not built in. */
function outputStyleBlock(
  effective: EffectiveSetting[],
  inventory: Inventory
): ContextBlock | null {
  const style = effective.find((s) => s.key === "outputStyle")?.value;
  if (typeof style !== "string" || BUILT_IN_STYLES.includes(style.toLowerCase())) return null;
  const custom = inventory.outputStyles.find((s) => s.name === style);
  if (custom)
    return block(
      { kind: "output-style", path: custom.path, scope: custom.scope },
      parseFrontmatter(custom.text).body
    );
  return block(
    {
      kind: "not-counted",
      path: `Output style "${style}"`,
      scope: "user",
      note: "ccdesk could not find this style's file",
    },
    null
  );
}

/**
 * The loaded instruction files, each after the files it imports. A file both imported and loaded
 * on its own (a rule, an AGENTS.md) is counted once, as itself, also when it is loaded through a
 * link, to it or to its folder, and imported by its real path.
 */
async function instructionBlocks(
  env: ScanEnv,
  projectRoot: string,
  instructions: Instruction[]
): Promise<ContextBlock[]> {
  const blocks: ContextBlock[] = [];
  const loaded = new Set(
    (
      await Promise.all(
        instructions
          .filter((i) => i.status === "loaded")
          .map(async (i) => [i.path, i.realPath ?? (await resolvedPath(i.path))])
      )
    ).flat()
  );
  const added = new Set<string>();
  // An imported file comes before the text that imports it ("Claude reads the imported file
  // first, then the rest"), and its own imports before it.
  const importsOf = async (file: Instruction, via: string) => {
    for (const ref of file.imports.filter((r) => r.via === via)) {
      if (!ref.exists || ref.skipped || loaded.has(ref.resolved) || added.has(ref.resolved))
        continue;
      added.add(ref.resolved);
      await importsOf(file, ref.resolved);
      blocks.push(await importBlock(env, projectRoot, file, ref, via));
    }
  };
  for (const file of instructions) {
    if (file.status !== "loaded") continue;
    await importsOf(file, file.path);
    blocks.push(
      block({ kind: "instruction", path: file.path, scope: file.scope }, injectedText(file.text))
    );
  }
  return blocks;
}

/** One imported file: its text, or why ccdesk does not count it. */
async function importBlock(
  env: ScanEnv,
  projectRoot: string,
  file: Instruction,
  ref: ImportRef,
  via: string
): Promise<ContextBlock> {
  const fields = { kind: "import" as const, path: ref.resolved, scope: file.scope, via };
  if (ref.pending)
    return block(
      { ...fields, note: "Not loaded until you approve imports from outside this project" },
      null
    );
  if (ref.tooLarge)
    return block({ ...fields, note: "Over 4 MiB, so Claude Code does not load it" }, null);
  if (!showable(env, projectRoot, ref.resolved))
    return block(
      {
        ...fields,
        note: "Outside this project and your Claude folders, so ccdesk does not show or count it. Claude Code loads it.",
      },
      null
    );
  const text = await readTextFile(env, ref.resolved);
  return block(fields, text ? injectedText(text.text) : null);
}

/**
 * The skill listing, the subagent descriptions and the MCP tool names Claude sees. A skill with
 * paths joins the listing only once Claude works with a matching file (docs: skills#frontmatter-reference).
 */
function listingBlocks(inventory: Inventory): ContextBlock[] {
  const blocks: ContextBlock[] = [];
  const listed = [...inventory.skills, ...inventory.commands].filter(
    (s) => s.listed !== false && !s.shadowedBy && !s.paths
  );
  const listing = skillListing(listed);
  if (listing)
    blocks.push(
      block(
        {
          kind: "skills",
          path: "Skill listing",
          scope: commonScope(listed),
          note: "Names and descriptions only; a skill's body loads when it is used. Claude Code drops descriptions if the listing passes 1% of the context window.",
        },
        listing
      )
    );
  const agents = inventory.agents
    .filter((a) => !a.shadowedBy && !a.skipped)
    .map((a) => `- ${a.id ?? a.name}: ${a.description}`)
    .join("\n");
  if (agents)
    blocks.push(
      block(
        {
          kind: "agents",
          path: "Subagent descriptions",
          scope: commonScope(inventory.agents),
          note: "Your subagents' descriptions; built-in subagents are not counted",
        },
        agents
      )
    );

  const servers = inventory.mcpServers.filter((s) => s.status === "active").length;
  if (servers > 0)
    blocks.push(
      block(
        {
          kind: "not-counted",
          path: `Tool names from ${servers} MCP ${servers === 1 ? "server" : "servers"}`,
          scope: "user",
          note: "ccdesk does not connect to MCP servers, so it cannot count their tools",
        },
        null
      )
    );
  return blocks;
}

import { join } from "node:path";
import {
  type Memory,
  type MemoryIndex,
  type MemoryStore,
  type MemoryType,
  type TextFile,
} from "../../shared/types.ts";
import { type ScanEnv } from "./env.ts";
import {
  isDir,
  listDir,
  parseFrontmatter,
  readTextFile,
  revisionOf,
  shortHash,
  stringField,
} from "./files.ts";

const INDEX_FILE = "MEMORY.md";
/** Claude Code reads only this much of MEMORY.md at session start (docs: memory#auto-memory). */
const INDEX_LINE_LIMIT = 200;
const INDEX_BYTE_LIMIT = 25 * 1024;
const TYPES: MemoryType[] = ["user", "feedback", "project", "reference"];

/** Claude Code names a project's store after its path with every non-alphanumeric character as "-". */
export function storeDirName(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, "-");
}

export async function readMemoryStore(
  env: ScanEnv,
  dir: string,
  projectPath: string | null
): Promise<MemoryStore | null> {
  if (!(await isDir(dir))) return null;
  const indexFile = await readTextFile(env, join(dir, INDEX_FILE));
  const files = (await listDir(dir)).filter((f) => f.endsWith(".md") && f !== INDEX_FILE);

  const memories: Memory[] = [];
  for (const file of files) {
    const text = await readTextFile(env, join(dir, file));
    if (!text) continue;
    const { data, body } = parseFrontmatter(text.text);
    const metadata =
      typeof data.metadata === "object" && data.metadata !== null
        ? (data.metadata as Record<string, unknown>)
        : {};
    const rawType = stringField(metadata, "type") || stringField(data, "type");
    memories.push({
      file,
      path: text.path,
      name: stringField(data, "name") || file.replace(/\.md$/, ""),
      description: stringField(data, "description"),
      type: TYPES.includes(rawType as MemoryType) ? (rawType as MemoryType) : "unknown",
      body,
      mtime: text.mtime,
      bytes: text.bytes,
      revision: revisionOf(text.text),
      inIndex: indexFile ? indexMentions(indexFile.text, file) : false,
      hash: shortHash(body.trim()),
      links: wikiLinks(body),
      brokenLinks: [],
      linkedFrom: [],
    });
  }

  const names = new Set(memories.map((m) => m.name));
  for (const memory of memories) {
    memory.brokenLinks = memory.links.filter((link) => !names.has(link));
    for (const link of memory.links) {
      const target = memories.find((m) => m.name === link);
      if (target && target !== memory && !target.linkedFrom.includes(memory.name))
        target.linkedFrom.push(memory.name);
    }
  }

  return {
    dir,
    loaded: true,
    projectPath,
    index: indexFile ? summarizeIndex(indexFile, files) : null,
    memories,
  };
}

function summarizeIndex(file: TextFile, files: string[]): MemoryIndex {
  // A file's last newline ends its last line; it does not start another one.
  const lines = file.text.replace(/\n$/, "").split("\n");
  let loadedLines = 0;
  let bytes = 0;
  for (const line of lines) {
    bytes += Buffer.byteLength(line, "utf8") + 1;
    if (loadedLines >= INDEX_LINE_LIMIT || bytes > INDEX_BYTE_LIMIT) break;
    loadedLines++;
  }
  return {
    ...file,
    revision: revisionOf(file.text),
    truncated: loadedLines < lines.length,
    loadedLines,
    missingFiles: [...new Set(file.text.split("\n").flatMap((l) => deadLinks(l, files)))],
  };
}

/** Memory files an index line links to that are not in the store. */
export function deadLinks(line: string, files: string[]): string[] {
  return [...line.matchAll(/\]\(([^)\s/\\]+\.md)\)/g)]
    .map((m) => m[1] ?? "")
    .filter((f) => !files.includes(f));
}

/** Whether MEMORY.md text points at a memory file, as a Markdown link or a [[name]] link. */
export function indexMentions(index: string, file: string): boolean {
  return index.includes(`(${file})`) || index.includes(`[[${file.replace(/\.md$/, "")}]]`);
}

function wikiLinks(body: string): string[] {
  return [...new Set([...body.matchAll(/\[\[([^\]\n|]+)\]\]/g)].map((m) => (m[1] ?? "").trim()))];
}

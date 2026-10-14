import { join } from "node:path";
import {
  type Memory,
  type MemoryIndex,
  type MemoryStore,
  type MemoryType,
  type Problem,
  type TextFile,
} from "../../shared/types.ts";
import { type ScanEnv } from "./env.ts";
import {
  isDir,
  isFile,
  listDir,
  readTextFile,
  revisionOf,
  shortHash,
  stringField,
} from "./files.ts";
import { isRecord, parseFrontmatter } from "./data.ts";

const INDEX_FILE = "MEMORY.md";
/** Claude Code reads only this much of MEMORY.md at session start (docs: memory#auto-memory). */
const INDEX_LINE_LIMIT = 200;
const INDEX_BYTE_LIMIT = 25 * 1024;
const TYPES: MemoryType[] = ["user", "feedback", "project", "reference"];

/** The memory files in `dir`; a file that is there but cannot be read goes into `problems`. */
export async function readMemoryStore(
  env: ScanEnv,
  dir: string,
  projectPath: string | null,
  problems?: Problem[]
): Promise<MemoryStore | null> {
  if (!(await isDir(dir))) return null;
  const indexFile = await readTextFile(env, join(dir, INDEX_FILE), problems);
  const files = (await listDir(dir)).filter((f) => f.endsWith(".md") && f !== INDEX_FILE);

  const memories: Memory[] = [];
  for (const file of files) {
    const text = await readTextFile(env, join(dir, file), problems);
    if (!text) continue;
    const { data, body } = parseFrontmatter(text.text);
    const metadata = isRecord(data.metadata) ? data.metadata : {};
    const rawType = stringField(metadata, "type") || stringField(data, "type");
    memories.push({
      file,
      path: text.path,
      name: stringField(data, "name") || file.replace(/\.md$/, ""),
      description: stringField(data, "description"),
      type: TYPES.find((t) => t === rawType) ?? "unknown",
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
    index: indexFile ? summarizeIndex(indexFile, await missingLinks(dir, indexFile.text)) : null,
    memories,
  };
}

function summarizeIndex(file: TextFile, missing: Set<string>): MemoryIndex {
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
    missingFiles: [...new Set(file.text.split("\n").flatMap((l) => deadLinks(l, missing)))],
  };
}

/** An inline link, `[text](target)` with an optional title, the target bare or in `<>`. */
const INLINE_LINK =
  /\]\(\s*(<[^>\n]*>|[^\s()<>]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/g;
/** A reference definition, `[label]: target`. */
const DEFINITION = /^ {0,3}\[[^\]\n]+\]:\s*(<[^>\n]*>|\S+)/;
/** Bracketed text that is not an inline link's text, a [[name]] link or a definition: a reference link, or text. */
const REFERENCE = /(?<!\[)\[[^[\]\n]+\](?!\(|\]|:)/g;

/**
 * What an index line's links point at: each memory file's name, with `%xx` decoded and a leading
 * `./` dropped, or null for a link ccdesk cannot tie to one file in the folder, such as a reference
 * link, a path into another folder or a web address.
 */
function lineTargets(line: string): Array<string | null> {
  const inline = [...line.matchAll(INLINE_LINK)];
  const targets = inline.map((m) => memoryTarget(m[1] ?? ""));
  // An inline link the pattern did not read, such as one with parentheses in its target.
  const unread = line.split("](").length - 1 - inline.length;
  for (let i = 0; i < unread; i++) targets.push(null);
  const definition = DEFINITION.exec(line);
  if (definition) targets.push(memoryTarget(definition[1] ?? ""));
  else for (const _ of line.matchAll(REFERENCE)) targets.push(null);
  return targets;
}

function memoryTarget(written: string): string | null {
  const target = written.startsWith("<") ? written.slice(1, -1) : written;
  const name = linkedName(target.replace(/^(?:\.\/)+/, ""));
  return /^[^/\\:?#]+\.md$/.test(name) ? name : null;
}

/** The memory files an index line links to, by name (see lineTargets). */
function fileLinks(line: string): string[] {
  return lineTargets(line).filter((t): t is string => t !== null);
}

/** A link's file name with `%xx` decoded, as in `my%20note.md`; one that would leave the folder stays as written. */
function linkedName(link: string): string {
  try {
    const name = decodeURIComponent(link);
    return /[/\\]/.test(name) ? link : name;
  } catch {
    return link;
  }
}

/**
 * The memory files `index` links to that are not in `dir`. Each is looked up on disk, so a link
 * that differs from the file's name only in case still counts on a file system that ignores case.
 */
export async function missingLinks(dir: string, index: string): Promise<Set<string>> {
  const missing = new Set<string>();
  for (const name of new Set(index.split("\n").flatMap(fileLinks)))
    if (!(await isFile(join(dir, name)))) missing.add(name);
  return missing;
}

/** The memory files an index line links to that are in `missing`. */
export function deadLinks(line: string, missing: Set<string>): string[] {
  return fileLinks(line).filter((name) => missing.has(name));
}

/**
 * Whether every memory an index line points at, by Markdown link or [[name]] link, is one of
 * `files`: only then can the line go with them without losing a pointer that still works. A line
 * with a link ccdesk cannot tie to a file stays.
 */
export function pointsOnlyAt(line: string, files: string[]): boolean {
  const names = new Set(files);
  const targets = [...lineTargets(line), ...wikiLinks(line).map((n) => `${n}.md`)];
  return targets.every((target) => target !== null && names.has(target));
}

/** Whether MEMORY.md text points at a memory file, as a Markdown link or a [[name]] link. */
export function indexMentions(index: string, file: string): boolean {
  return (
    index.includes(`(${file})`) ||
    index.split("\n").some((line) => fileLinks(line).includes(file)) ||
    index.includes(`[[${file.replace(/\.md$/, "")}]]`)
  );
}

function wikiLinks(body: string): string[] {
  return [...new Set([...body.matchAll(/\[\[([^\]\n|]+)\]\]/g)].map((m) => (m[1] ?? "").trim()))];
}

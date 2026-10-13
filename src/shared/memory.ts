/** Longest store name Claude Code keeps as it is; a longer one is cut and given a hash of the path. */
const MAX_STORE_NAME = 200;

/**
 * Claude Code names a project's store after its path with every non-alphanumeric character as "-".
 * A name over 200 characters is cut there and ends with "-" and a hash of the whole path, so deep
 * paths that share a start get different stores (observed in the SDK 0.3.296; the docs do not say).
 */
export function storeDirName(projectPath: string): string {
  const name = projectPath.replace(/[^a-zA-Z0-9]/g, "-");
  if (name.length <= MAX_STORE_NAME) return name;
  return `${name.slice(0, MAX_STORE_NAME)}-${Math.abs(pathHash(projectPath)).toString(36)}`;
}

/** Java's 32-bit string hash, over UTF-16 code units, as Claude Code computes it. */
function pathHash(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return hash;
}

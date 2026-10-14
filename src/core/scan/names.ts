/**
 * Names as Claude Code compares them for the names it keeps for skills synced from claude.ai
 * (observed in v2.1.296; docs: skills#names-reserved-for-synced-skills).
 */

/**
 * A name as Claude Code compares a synced skill's with other commands': without case, spacing or
 * invisible characters, with compatibility forms such as fullwidth letters and dash variants as
 * their plain equivalents (docs: skills#when-a-synced-skill-name-matches-another-command).
 */
export function foldedName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\p{Z}\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}⠀]/gu, "")
    .replace(/[\p{Pd}−]/gu, "-")
    .toLowerCase();
}

/** Whether a name is in the `anthropic-skills` namespace, compared as foldedName does. */
export function isReservedName(name: string): boolean {
  const folded = foldedName(name);
  return folded === "anthropic-skills" || folded.startsWith("anthropic-skills:");
}

/**
 * Whether a folder is named `synced`, the folder Claude Code syncs skills into: compared without
 * case or invisible direction marks, and without trailing dots and spaces, which Windows drops.
 */
export function isSyncedFolder(name: string): boolean {
  const bare = name.replace(/[. ]+$/, "").replace(/[‌-‏‪-‮⁪-⁯﻿]/g, "");
  return bare.normalize("NFD").toUpperCase().toLowerCase() === "synced";
}

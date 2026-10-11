import { HIGHEST_FIRST } from "../../shared/scopes.ts";
import {
  type Permission,
  type PermissionList,
  type Scope,
  type SettingsLayer,
  type Trust,
} from "../../shared/types.ts";
import { isRecord, stringsIn } from "./files.ts";
import { ignoredModeReason } from "./settings.ts";

/**
 * Whether a file's trust-gated settings (permission grants, hooks, autoMemoryDirectory) wait for
 * the workspace trust dialog. Claude Code runs git to tell a private local file from a committed one
 * only once the folder or a parent is trusted, so until then the local file waits too, except in
 * your configuration home; a committed local file waits like project settings.
 */
export function trustWaits({
  trust,
  inConfigHome,
  localFromRepository,
}: Options): (scope: Scope) => boolean {
  const localWaits =
    !inConfigHome && (trust.trusted ? false : !trust.inheritedFrom || localFromRepository);
  return (scope) => (scope === "project" && !trust.trusted) || (scope === "local" && localWaits);
}

/** Claude Code checks every file's rules together: deny, then ask, then allow (docs: permissions). */
const CHECK_ORDER: PermissionList[] = ["deny", "ask", "allow"];

export interface Options {
  trust: Trust;
  /** Claude Code started in your configuration home, where the local file applies without the trust step. */
  inConfigHome: boolean;
  /** The local settings file is tracked in git, so Claude Code treats it like repository settings. */
  localFromRepository: boolean;
}

/**
 * Every permission entry from every settings file, each marked with whether Claude Code applies it
 * (docs: permissions#project-allow-rules-and-workspace-trust, settings-reference#permissions-defaultmode,
 * #allowmanagedpermissionrulesonly).
 */
export function permissionsOf(layers: SettingsLayer[], options: Options): Permission[] {
  const sources = HIGHEST_FIRST.flatMap((scope) =>
    layers
      .filter((l) => l.scope === scope && isRecord(l.data?.permissions))
      .map((l) => ({
        scope,
        path: l.path,
        permissions: l.data?.permissions as Record<string, unknown>,
      }))
  );
  const managedOnly = layers.some(
    (l) => l.scope === "managed" && l.data?.allowManagedPermissionRulesOnly === true
  );
  // Grants from repository files wait for the workspace trust dialog; deny and ask apply at once.
  const waitsForTrust = trustWaits(options);
  const notTrusted = "Waits until you trust this folder in Claude Code";

  const rules = sources.flatMap(({ scope, path, permissions }) =>
    CHECK_ORDER.flatMap((list) =>
      stringsIn(permissions[list]).map((rule): Permission & { kind: "rule" } => {
        const base = { kind: "rule" as const, list, rule, scope, path };
        if (managedOnly && scope !== "managed")
          return {
            ...base,
            inEffect: false,
            note: "Managed settings allow only their own permission rules",
          };
        if (list === "allow" && waitsForTrust(scope))
          return { ...base, inEffect: false, note: notTrusted };
        return { ...base, inEffect: true };
      })
    )
  );
  for (const r of rules) {
    if (!r.inEffect) continue;
    const first = CHECK_ORDER.map((list) =>
      rules.find((o) => o.inEffect && o.list === list && o.rule === r.rule)
    ).find((o) => o !== undefined);
    if (first && first.list !== r.list) r.decidedBy = { list: first.list, scope: first.scope };
  }

  const out: Permission[] = [...rules];
  let modeTaken = false;
  for (const { scope, permissions } of sources) {
    const mode = permissions.defaultMode;
    if (typeof mode !== "string") continue;
    let note = ignoredModeReason(scope, mode);
    if (!note && modeTaken) note = "A higher settings file sets the default mode";
    out.push({
      kind: "defaultMode",
      value: mode,
      scope,
      inEffect: !note,
      ...(note ? { note } : {}),
    });
    if (!note) modeTaken = true;
  }
  for (const { scope, permissions } of sources) {
    for (const dir of stringsIn(permissions.additionalDirectories)) {
      const note = waitsForTrust(scope) ? notTrusted : undefined;
      out.push({
        kind: "additionalDirectories",
        value: dir,
        scope,
        inEffect: !note,
        ...(note ? { note } : {}),
      });
    }
  }
  return out;
}

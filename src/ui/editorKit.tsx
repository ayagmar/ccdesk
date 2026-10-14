import { EDITABLE_SCOPES } from "../shared/scopes.ts";
import { type DirectoryView, type Scope } from "../shared/types.ts";
import { lineName } from "../view/lines.ts";
import { Bullet } from "./Bullet.tsx";

/** The settings file of one scope in this directory, which a new rule or hook goes into. */
export function fileFor(view: DirectoryView, scope: Scope): string | undefined {
  return view.settings.find((l) => l.scope === scope && !l.legacy)?.path;
}

/**
 * Whether a new value may go into a scope's file here. A folder that no longer exists keeps only
 * your user files: writing its project or local files would create it again, and nothing scoped to
 * it applies until a session starts there.
 */
export function canWrite(view: DirectoryView, scope: Scope): boolean {
  return view.exists || scope === "user";
}

/** `scopes` without the ones `canWrite` refuses here. */
export function writable<S extends Scope>(view: DirectoryView, scopes: readonly S[]): S[] {
  return scopes.filter((s) => canWrite(view, s));
}

/**
 * `scope` where it can be written here, or else the user scope. Editors pass the scope picked in
 * them through it on every render, so a folder that goes away while a form is open gets user files.
 */
export function writableOr<S extends Scope>(view: DirectoryView, scope: S): S | "user" {
  return canWrite(view, scope) ? scope : "user";
}

/** Project settings, or user settings where there is no project file, as in your home folder. */
export function projectOrUser(view: DirectoryView): Scope {
  return fileFor(view, "project") ? writableOr(view, "project") : "user";
}

/**
 * One button per scope, the picked one with a filled bullet. `unavailable` says why a scope cannot
 * be picked; it is undefined for one that can.
 */
export function ScopeButtons<S extends Scope>({
  label,
  scopes,
  scope,
  onPick,
  unavailable = () => undefined,
}: {
  label: string;
  scopes: readonly S[];
  scope: S;
  onPick: (scope: S) => void;
  unavailable?: (scope: S) => string | undefined;
}) {
  return (
    <fieldset className="segmented" aria-label={label}>
      {scopes.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={scope === s}
          disabled={unavailable(s) !== undefined}
          title={unavailable(s)}
          onClick={() => onPick(s)}
        >
          <Bullet line={s} hollow={scope !== s} ariaHidden /> {lineName(s)}
        </button>
      ))}
    </fieldset>
  );
}

/** Which settings file a new rule or hook goes into: user, project or local. */
export function ScopePicker({
  view,
  scope,
  onPick,
}: {
  view: DirectoryView;
  scope: Scope;
  onPick: (scope: Scope) => void;
}) {
  return (
    <ScopeButtons
      label="File to change"
      scopes={writable(view, EDITABLE_SCOPES)}
      scope={scope}
      onPick={onPick}
      // In your home folder .claude/settings.json is your user file, so there is no project file.
      unavailable={(s) =>
        fileFor(view, s) ? undefined : `No ${lineName(s).toLowerCase()} settings file here`
      }
    />
  );
}

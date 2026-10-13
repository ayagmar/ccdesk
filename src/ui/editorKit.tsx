import { EDITABLE_SCOPES } from "../shared/scopes.ts";
import { type DirectoryView, type Scope } from "../shared/types.ts";
import { lineName } from "../view/lines.ts";
import { Bullet } from "./Bullet.tsx";

/** The settings file of one scope in this directory, which a new rule or hook goes into. */
export function fileFor(view: DirectoryView, scope: Scope): string | undefined {
  return view.settings.find((l) => l.scope === scope && !l.legacy)?.path;
}

/** Project settings, or user settings where there is no project file, as in your home folder. */
export function projectOrUser(view: DirectoryView): Scope {
  return fileFor(view, "project") ? "project" : "user";
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
          <Bullet line={s} hollow={scope !== s} /> {lineName(s)}
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
      scopes={EDITABLE_SCOPES}
      scope={scope}
      onPick={onPick}
      // In your home folder .claude/settings.json is your user file, so there is no project file.
      unavailable={(s) =>
        fileFor(view, s) ? undefined : `No ${lineName(s).toLowerCase()} settings file here`
      }
    />
  );
}

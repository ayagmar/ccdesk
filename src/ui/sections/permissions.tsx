import { useState } from "react";
import { EDITABLE_SCOPES } from "../../shared/scopes.ts";
import { type Permission, type Scope, type Usage } from "../../shared/types.ts";
import { lineName } from "../../view/lines.ts";
import { isSuggested, type Rule, type Suggested, unused } from "../../view/sections/permissions.ts";
import { type RowOf } from "../../view/sections/types.ts";
import { sessionsHere } from "../../view/usage.ts";
import { Bullet } from "../Bullet.tsx";
import { ago, plural, tilde, tildeAll } from "../format.ts";
import { fileFor, ScopePicker } from "../editorKit.tsx";
import { Icon } from "../Icon.tsx";
import { PermissionEditor, usePermissionChange } from "../PermissionEditor.tsx";
import { SettingEditor } from "../SettingEditor.tsx";
import { Field, NameButton, PathValue } from "./kit.tsx";
import { type Actions, type SectionUi } from "./types.ts";

type R = RowOf<"permissions">;
const OUTCOME = { allow: "runs without asking", ask: "asks you first", deny: "blocked" } as const;

export const permissions: SectionUi<R> = {
  cells: (row, actions, name) => {
    if (isSuggested(row))
      return (
        <>
          <td />
          <td>
            <span className="muted">suggested</span>
          </td>
          <td className="mono value">
            <NameButton {...name}>{row.item.rule}</NameButton>
          </td>
          <td className="desc">
            you allowed it {plural(row.item.approved, "time")}
            <span className="muted"> · {ago(row.item.last)}</span>
          </td>
        </>
      );
    const p = row.item;
    return (
      <>
        <td>
          <Bullet line={row.line} />
        </td>
        <td>
          {p.kind === "rule" ? (
            <span className={`perm perm-${p.list}`}>{p.list}</span>
          ) : (
            <span className="muted">
              {p.kind === "defaultMode" ? "default mode" : "extra folder"}
            </span>
          )}
        </td>
        <td className="mono value">
          <NameButton {...name}>{p.kind === "rule" ? p.rule : tildeAll(p.value)}</NameButton>
        </td>
        <td className="desc">
          <Outcome p={p} usage={actions.view.usage} />
        </td>
      </>
    );
  },
  Head: ({ actions }) => (
    <>
      <span className="tt-note">Checked deny, then ask, then allow, across every file</span>
      <button type="button" className="head-action" onClick={() => actions.onAdd("permission")}>
        <Icon name="plus" /> Add rule
      </button>
    </>
  ),
  Details: ({ row, actions }) => {
    if (isSuggested(row)) return <SuggestedRule key={row.id} row={row} actions={actions} />;
    const p = row.item;
    const { view } = actions;
    const file =
      p.kind === "rule"
        ? p.path
        : view.settings.find((l) => l.scope === p.scope && !l.legacy)?.path;
    return (
      <>
        <Verdict p={p} />
        <dl className="fields">
          {p.kind === "rule" && <Field label="List">{p.list}</Field>}
          <Field label={p.kind === "rule" ? "Rule" : "Value"}>
            <span className="mono wrap">{p.kind === "rule" ? p.rule : tildeAll(p.value)}</span>
          </Field>
          <Field label="Set in">{lineName(p.scope)} settings</Field>
          {p.kind === "rule" && p.list !== "deny" && p.inEffect && (
            <Field label="Covered here">
              <CoveredCalls rule={p} usage={view.usage} />
            </Field>
          )}
          {file && (
            <Field label="File">
              <PathValue path={file} />
            </Field>
          )}
        </dl>
        <section className="sub">
          <h3>How Claude Code decides</h3>
          <p className="muted small">
            Rules from every settings file are pooled and checked in order: deny, then ask, then
            allow. The first match decides, so a deny in any file beats an allow in any other.
          </p>
        </section>
        {p.kind === "rule" ? (
          <>
            <h3 className="sub-title">Change this rule</h3>
            <PermissionEditor key={row.id} view={view} rule={p} onSaved={actions.onSaved} />
          </>
        ) : (
          <>
            <h3 className="sub-title">Change permissions</h3>
            <SettingEditor
              key={p.scope}
              view={view}
              settingKey="permissions"
              defaultScope={EDITABLE_SCOPES.includes(p.scope) ? p.scope : "user"}
              onSaved={actions.onSaved}
            />
          </>
        )}
      </>
    );
  },
};

const VERDICTS = {
  allow: "Claude uses matching tools without asking, unless a deny or ask rule matches first.",
  ask: "Claude asks before using matching tools, unless a deny rule matches first.",
  deny: "Claude may not use matching tools. No allow rule in any file can undo this.",
} as const;

/** What a rule or setting does here, in the table. */
function Outcome({ p, usage }: { p: Permission; usage: Usage | null | undefined }) {
  if (!p.inEffect) return <span className="flag warn">{p.note ?? "not in effect"}</span>;
  if (p.kind === "defaultMode") return "how sessions start";
  if (p.kind !== "rule") return "Claude may read and edit here";
  if (p.decidedBy)
    return (
      <span className="flag warn">
        {p.decidedBy.list === "deny" ? "denied" : "asks first"}: same rule in {p.decidedBy.list} (
        {p.decidedBy.scope})
      </span>
    );
  return (
    <>
      {OUTCOME[p.list]}
      {unused(p, usage) && <span className="flag">covered no call here</span>}
    </>
  );
}

/** What a rule or setting does here, in the inspector. */
function Verdict({ p }: { p: Permission }) {
  if (!p.inEffect) return <p className="verdict off">{p.note}</p>;
  if (p.kind === "defaultMode")
    return <p className="verdict">{`Sessions here start in ${p.value} mode.`}</p>;
  if (p.kind !== "rule")
    return (
      <p className="verdict">
        Claude may read and edit files in this folder as well as the project.
      </p>
    );
  if (p.decidedBy)
    return (
      <p className="verdict off">
        {`This ${p.list} rule never applies: the same rule is in ${p.decidedBy.list} (${p.decidedBy.scope} settings), which is checked first.`}
      </p>
    );
  return <p className={`verdict ${p.list === "deny" ? "" : "ok"}`}>{VERDICTS[p.list]}</p>;
}

/** How many of the calls counted here a rule covers. */
function CoveredCalls({ rule, usage }: { rule: Rule; usage: Usage | null | undefined }) {
  if (usage === undefined) return <span className="muted">counting…</span>;
  if (usage === null)
    return <span className="muted">ccdesk could not finish counting the transcripts</span>;
  const matches = usage.matches[rule.rule];
  if (matches === undefined) return <span className="muted">counting…</span>;
  if (matches === null)
    return (
      <span className="muted">not counted: ccdesk matches tool, command and domain rules</span>
    );
  if (usage.sessions === 0) return <span className="muted">no sessions here yet</span>;
  return (
    <>
      {plural(matches, "call")} in {sessionsHere(usage)}
      {matches === 0 && rule.list === "allow" && (
        <span className="muted small">
          {" "}
          {rule.scope === "user"
            ? "Your user settings apply in every directory, so others may still use it."
            : "If Claude no longer needs it here, removing it narrows what runs without asking."}
        </span>
      )}
    </>
  );
}

/**
 * Calls Claude Code asked you about and you allowed, with none it covers refused: one allow rule
 * would let them run without asking. It goes in local settings by default, as Claude Code's "don't ask again" does.
 */
function SuggestedRule({ row, actions }: { row: Suggested; actions: Actions }) {
  const { view } = actions;
  const change = usePermissionChange(view, actions.onSaved);
  const [scope, setScope] = useState<Scope>("local");
  const file = fileFor(view, scope);
  const { rule, approved, last } = row.item;
  const prefix = /^Bash\((.+) \*\)$/.exec(rule)?.[1];
  return (
    <>
      <p className="verdict">
        Claude Code asked you {plural(approved, "time")} about calls this rule covers, and you
        allowed each one, refusing none of the calls it covers. An allow rule lets Claude make them
        without asking, unless a deny or ask rule matches first.
      </p>
      <dl className="fields">
        <Field label="Rule">
          <span className="mono wrap">{rule}</span>
        </Field>
        <Field label="You allowed">{plural(approved, "call")}</Field>
        <Field label="Last asked">{ago(last)}</Field>
      </dl>
      {prefix && (
        <p className="muted small">
          It allows every command that starts with <code>{prefix}</code>, with any arguments.
        </p>
      )}
      <section className="sub editor" aria-label="Allow this rule">
        <h3>Allow it</h3>
        <p className="muted small">
          In local settings it applies only for you here; in project settings, for everyone working
          in this repository; in your user settings, in every project.
        </p>
        <ScopePicker
          view={view}
          scope={scope}
          onPick={(s) => {
            setScope(s);
            change.cancel();
          }}
        />
        <p className="muted small mono wrap">{file ? tilde(file) : ""}</p>
        {!change.reviewing && (
          <div className="editor-buttons">
            <button
              type="button"
              className="primary"
              disabled={change.busy || !file}
              onClick={() =>
                file &&
                void change.start(
                  file,
                  undefined,
                  { list: "allow", rule },
                  `Allowed ${rule} in ${lineName(scope).toLowerCase()} settings`
                )
              }
            >
              Review change
            </button>
          </div>
        )}
        {change.shown}
      </section>
      <p className="muted small">
        Counted from Claude Code's transcripts for{" "}
        {view.usage ? sessionsHere(view.usage) : "this directory"}. ccdesk reads each call's tool,
        command or address and whether you allowed it, and shows only counts and rule patterns,
        never what was in a session.
      </p>
    </>
  );
}

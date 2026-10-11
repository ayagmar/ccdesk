import { useState } from "react";
import { EDITABLE_SCOPES } from "../../shared/scopes.ts";
import { type Permission, type Scope, type Usage } from "../../shared/types.ts";
import { Bullet } from "../Bullet.tsx";
import { ago, plural, tilde, tildeAll } from "../format.ts";
import { Icon } from "../Icon.tsx";
import { lineName } from "../lines.ts";
import {
  fileFor,
  PermissionEditor,
  ScopePicker,
  usePermissionChange,
} from "../PermissionEditor.tsx";
import { SettingEditor } from "../SettingEditor.tsx";
import { sessionsHere, suggestedRules } from "../usage.ts";
import { Field, NameButton, PathValue } from "./kit.tsx";
import { type Actions, defineSection, type RowOf } from "./types.ts";

type R = RowOf<"permissions">;
type Suggested = Extract<R, { suggested: true }>;
type Rule = Extract<Permission, { kind: "rule" }>;

function isSuggested(row: R): row is Suggested {
  return "suggested" in row;
}

/**
 * An allow rule in effect that covered none of the calls counted here. Ask rules are not flagged:
 * they guard calls, so one that never fired is no reason to remove it.
 */
function unused(rule: Permission, usage: Usage | null | undefined): rule is Rule {
  return (
    rule.kind === "rule" &&
    rule.list === "allow" &&
    rule.inEffect &&
    !rule.decidedBy &&
    !!usage &&
    usage.sessions > 0 &&
    usage.matches[rule.rule] === 0
  );
}

const OUTCOME = { allow: "runs without asking", ask: "asks you first", deny: "blocked" } as const;
const LIST_ORDER = ["deny", "ask", "allow"];

export const permissions = defineSection<R>({
  id: "permissions",
  title: "Permissions",
  rows: (view) => {
    const ids = new Set<string>();
    const set: R[] = view.permissions.map((item) => {
      // Keyed by content so a selection survives a refresh; a repeated entry gets a suffix.
      const base = `perm:${item.scope}:${item.kind === "rule" ? `${item.list}:${item.rule}` : `${item.kind}:${item.value}`}`;
      let id = base;
      for (let n = 2; ids.has(id); n++) id = `${base}#${n}`;
      ids.add(id);
      return { id, section: "permissions", line: item.scope, item };
    });
    const suggested: R[] = suggestedRules(view).map((item) => ({
      id: `perm:suggested:${item.rule}`,
      section: "permissions",
      line: null,
      item,
      suggested: true,
    }));
    return [...set, ...suggested];
  },
  columns: [
    { label: "", sort: (r) => (isSuggested(r) ? "~" : r.item.scope) },
    {
      label: "List",
      sort: (r) =>
        isSuggested(r) ? 4 : r.item.kind === "rule" ? LIST_ORDER.indexOf(r.item.list) : 3,
    },
    {
      label: "Rule",
      sort: (r) => ("rule" in r.item ? r.item.rule : r.item.value),
    },
    { label: "Outcome" },
  ],
  cells: (row, actions, select) => {
    if (isSuggested(row))
      return (
        <>
          <td />
          <td>
            <span className="muted">suggested</span>
          </td>
          <td className="mono value">
            <NameButton onClick={select}>{row.item.rule}</NameButton>
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
          <NameButton onClick={select}>{p.kind === "rule" ? p.rule : tildeAll(p.value)}</NameButton>
        </td>
        <td className="desc">
          {!p.inEffect ? (
            <span className="flag warn">{p.note ?? "not in effect"}</span>
          ) : p.kind === "rule" && p.decidedBy ? (
            <span className="flag warn">
              {p.decidedBy.list === "deny" ? "denied" : "asks first"}: same rule in{" "}
              {p.decidedBy.list} ({p.decidedBy.scope})
            </span>
          ) : p.kind === "rule" ? (
            <>
              {OUTCOME[p.list]}
              {unused(p, actions.view.usage) && <span className="flag">covered no call here</span>}
            </>
          ) : p.kind === "defaultMode" ? (
            "how sessions start"
          ) : (
            "Claude may read and edit here"
          )}
        </td>
      </>
    );
  },
  empty: () =>
    "No settings file sets permissions here, so Claude asks before using tools that need it.",
  dimmed: (row) =>
    !isSuggested(row) && (!row.item.inEffect || (row.item.kind === "rule" && !!row.item.decidedBy)),
  text: (row) =>
    isSuggested(row)
      ? `permission suggested allow ${row.item.rule}`
      : row.item.kind === "rule"
        ? `permission ${row.item.list} ${row.item.rule}`
        : `permission ${row.item.kind} ${row.item.value}`,
  label: (row) =>
    isSuggested(row)
      ? `suggested allow ${row.item.rule}`
      : row.item.kind === "rule"
        ? `${row.item.list} ${row.item.rule}`
        : `${row.item.kind} ${row.item.value}`,
  heading: (row) =>
    "rule" in row.item
      ? row.item.rule
      : row.item.kind === "defaultMode"
        ? "Default permission mode"
        : "Extra folder",
  facet: {
    label: "Filter permissions by list",
    of: (row) =>
      isSuggested(row) ? "suggested" : row.item.kind === "rule" ? row.item.list : "other",
    order: ["deny", "ask", "allow", "other", "suggested"],
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
        {!p.inEffect ? (
          <p className="verdict off">{p.note}</p>
        ) : p.kind === "rule" ? (
          <p className={`verdict ${p.decidedBy ? "off" : p.list === "deny" ? "" : "ok"}`}>
            {p.decidedBy
              ? `This ${p.list} rule never applies: the same rule is in ${p.decidedBy.list} (${p.decidedBy.scope} settings), which is checked first.`
              : {
                  allow:
                    "Claude uses matching tools without asking, unless a deny or ask rule matches first.",
                  ask: "Claude asks before using matching tools, unless a deny rule matches first.",
                  deny: "Claude may not use matching tools. No allow rule in any file can undo this.",
                }[p.list]}
          </p>
        ) : (
          <p className="verdict">
            {p.kind === "defaultMode"
              ? `Sessions here start in ${p.value} mode.`
              : "Claude may read and edit files in this folder as well as the project."}
          </p>
        )}
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
});

/** How many of the calls counted here a rule covers. */
function CoveredCalls({ rule, usage }: { rule: Rule; usage: Usage | null | undefined }) {
  if (usage === undefined) return <span className="muted">counting…</span>;
  if (usage === null) return <span className="muted">ccdesk could not read the transcripts</span>;
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
        {view.usage ? sessionsHere(view.usage) : "this directory"}. ccdesk reads only which tool ran
        and whether you allowed it; it never shows what was in a session.
      </p>
    </>
  );
}

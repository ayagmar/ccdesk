import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type DirectoryView,
  type Overview,
  type Reference,
  type SessionProfile,
  type Usage,
} from "../shared/types.ts";
import { formatter } from "../view/format.ts";
import { api, errorText } from "./api.ts";
import { setFormatter } from "./format.ts";
import { setReference } from "./reference.ts";

export type Load<T> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: T };

/**
 * The overview and the open directory, kept current: files changed elsewhere (an editor, Claude
 * itself) reload the page, and so does coming back to the tab, since ~/.claude.json is not watched.
 * `dir` is the directory shown.
 */
export function useConfig(requested: string | null | undefined, profile: SessionProfile) {
  const [overview, setOverview] = useState<Load<Overview>>({ state: "loading" });
  const [view, setView] = useState<Load<DirectoryView>>({ state: "loading" });
  // The directory the view was asked for; the server answers with the canonical path, which can
  // differ (a trailing slash, a link), so the two are not compared.
  const [viewFor, setViewFor] = useState<string | null>(null);
  // undefined asks for the directory ccdesk was started in; null for no directory.
  const launchDir = overview.state === "ready" ? overview.data.launchDir : null;
  const dir = requested === undefined ? launchDir : requested;

  const refreshOverview = useCallback(() => {
    api.overview().then(
      (data) => {
        setFormatter(formatter(data.home));
        setOverview({ state: "ready", data });
      },
      (error: unknown) => setOverview({ state: "error", message: errorText(error) })
    );
  }, []);
  useEffect(refreshOverview, [refreshOverview]);

  // The settings catalog and editors read it, so no directory is shown before it arrives.
  const [reference, setLoadedReference] = useState<Load<Reference>>({ state: "loading" });
  useEffect(() => {
    api.reference().then(
      (data) => {
        setReference(data);
        setLoadedReference({ state: "ready", data });
      },
      (error: unknown) => setLoadedReference({ state: "error", message: errorText(error) })
    );
  }, []);

  // Only the latest request may land, so a slow answer for a folder you left cannot replace the new one.
  const generation = useRef(0);
  const load = useCallback((path: string, asked: SessionProfile, quietly: boolean) => {
    const current = ++generation.current;
    if (!quietly) setView({ state: "loading" });
    api.directory(path, asked).then(
      (data) => {
        if (current !== generation.current) return;
        setView({ state: "ready", data });
        setViewFor(path);
      },
      (error: unknown) => {
        if (current === generation.current) setView({ state: "error", message: errorText(error) });
      }
    );
  }, []);

  useEffect(() => {
    if (dir !== null) load(dir, profile, false);
  }, [dir, profile, load]);

  // A change can finish after you opened another directory; it must reload the one now open.
  const dirRef = useRef(dir);
  dirRef.current = dir;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const reload = useCallback(() => {
    if (dirRef.current !== null) load(dirRef.current, profileRef.current, true);
    refreshOverview();
  }, [load, refreshOverview]);

  useEffect(() => {
    if (dir === null) return;
    const stop = new AbortController();
    const listen = async () => {
      let since = Date.now();
      while (!stop.signal.aborted) {
        try {
          const { changed, at } = await api.watch(dir, since, stop.signal);
          since = Math.max(since, at);
          if (changed && !stop.signal.aborted) reload();
        } catch {
          // Server stopped or the request was cancelled: wait before trying again.
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
    };
    void listen();
    return () => stop.abort();
  }, [dir, reload]);

  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 1500) return;
      last = Date.now();
      reload();
    };
    addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reload]);

  /** The open directory's view, once the one asked for has arrived. */
  const scanned =
    reference.state === "ready" &&
    view.state === "ready" &&
    viewFor === dir &&
    view.data.profile === profile
      ? view.data
      : null;

  // Counted after each scan, since the rules to match come from it; the last counts stay shown
  // until new ones arrive, so a reload does not flicker.
  const [usage, setUsage] = useState<{ path: string; data: Usage | null } | null>(null);
  useEffect(() => {
    if (!scanned) return;
    // Aborting tells the server nobody waits for this count any more, so it stops.
    const stop = new AbortController();
    const rules = scanned.permissions.flatMap((p) =>
      p.kind === "rule" && p.inEffect ? [{ list: p.list, rule: p.rule }] : []
    );
    api.usage(scanned.path, rules, stop.signal).then(
      (data) => !stop.signal.aborted && setUsage({ path: scanned.path, data }),
      () => !stop.signal.aborted && setUsage({ path: scanned.path, data: null })
    );
    return () => stop.abort();
  }, [scanned]);

  const withUsage = useMemo(
    () => (scanned && usage?.path === scanned.path ? { ...scanned, usage: usage.data } : scanned),
    [scanned, usage]
  );
  return {
    overview,
    view: reference.state === "error" ? reference : view,
    data: withUsage,
    dir,
    reload,
  };
}

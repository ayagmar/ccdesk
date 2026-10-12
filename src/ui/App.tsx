import { useCallback, useEffect, useMemo, useState } from "react";
import { ChangesPage } from "./ChangesPage.tsx";
import { ComparePage } from "./ComparePage.tsx";
import { DirectoryPage } from "./DirectoryPage.tsx";
import { OverviewPage } from "./OverviewPage.tsx";
import { Palette } from "./Palette.tsx";
import { Rail } from "./Rail.tsx";
import { buildRows } from "./sections/index.ts";
import { Toast, type ToastMessage } from "./Toast.tsx";
import { type Page, pushPage, readPage } from "./url.ts";
import { useConfig } from "./useConfig.ts";

function isDark(): boolean {
  const theme = document.documentElement.dataset.theme;
  return theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}

export function App() {
  const [page, setPage] = useState<Page>(readPage);
  // Open to jump, or with `compareFrom` to pick a directory to compare that one's settings with.
  const [palette, setPalette] = useState<{ compareFrom?: string } | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [jump, setJump] = useState<{ id: string } | null>(null);
  const [dark, setDark] = useState(isDark);
  // Counts navigations, so a page opened again, or reached through history, rereads its lists' state.
  const [visit, setVisit] = useState(0);

  // A directory page opened without a path shows the directory ccdesk was started in.
  const config = useConfig(page.kind === "directory" ? page.dir : null);
  const { view, data, dir, reload } = config;
  const overview = config.overview.state === "ready" ? config.overview.data : null;
  const rows = useMemo(() => (data ? buildRows(data) : []), [data]);

  const open = useCallback((next: Page) => {
    setPage(next);
    setVisit((v) => v + 1);
    pushPage(next);
  }, []);
  const openDirectory = useCallback(
    (path: string | null) =>
      open(path === null ? { kind: "all" } : { kind: "directory", dir: path }),
    [open]
  );
  useEffect(() => {
    const onPop = () => {
      setPage(readPage());
      setVisit((v) => v + 1);
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => (p ? null : {}));
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const toggleTheme = () => {
    const next = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setDark(next === "dark");
    try {
      localStorage.setItem("ccdesk-theme", next);
    } catch {
      // The theme just won't persist.
    }
  };

  const clearToast = useCallback(() => setToast(null), []);
  const pickCompared = useCallback((dir: string) => setPalette({ compareFrom: dir }), []);

  return (
    <div className="app">
      <Rail
        overview={overview}
        current={
          page.kind === "directory" ? (data?.path ?? dir) : page.kind === "all" ? null : undefined
        }
        changesOpen={page.kind === "changes"}
        dark={dark}
        onOpen={openDirectory}
        onChanges={() => open({ kind: "changes" })}
        onToggleTheme={toggleTheme}
      />
      <main className="main">
        {config.overview.state === "error" ? (
          <Problem message={config.overview.message} />
        ) : page.kind === "changes" ? (
          <ChangesPage
            onRestored={(text) => {
              setToast({ text });
              reload();
            }}
          />
        ) : page.kind === "compare" ? (
          <ComparePage
            key={visit}
            dir={page.dir}
            other={page.other}
            onOpen={openDirectory}
            onPickOther={() => pickCompared(page.dir)}
          />
        ) : page.kind === "all" ? (
          overview ? (
            <OverviewPage key={visit} overview={overview} onOpen={openDirectory} />
          ) : (
            <Loading />
          )
        ) : view.state === "error" ? (
          <Problem message={view.message} />
        ) : !data ? (
          <Loading />
        ) : (
          <DirectoryPage
            key={`${data.path}:${visit}`}
            view={data}
            overview={overview}
            rows={rows}
            jump={jump}
            onJumped={() => setJump(null)}
            reload={reload}
            onToast={setToast}
            onOpenDirectory={openDirectory}
            onOpenPalette={() => setPalette({})}
            onCompare={pickCompared}
          />
        )}
      </main>
      {palette && (
        <Palette
          overview={overview}
          rows={rows}
          compareFrom={palette.compareFrom}
          onClose={() => setPalette(null)}
          onCompare={(from, to) => open({ kind: "compare", dir: from, other: to })}
          onOpenDirectory={openDirectory}
          onSelectRow={(id) => setJump({ id })}
          onOpenMemory={(projectPath, path) => {
            if (projectPath !== dir) openDirectory(projectPath);
            setJump({ id: `mem:${path}` });
          }}
        />
      )}
      <Toast toast={toast} onDone={clearToast} />
    </div>
  );
}

function Loading() {
  return (
    <div className="loading" role="status">
      <span className="loading-line" aria-hidden="true" />
      Reading your config…
    </div>
  );
}

function Problem({ message }: { message: string }) {
  return (
    <div className="problem" role="alert">
      <h1>Something went wrong</h1>
      <p>{message}</p>
    </div>
  );
}

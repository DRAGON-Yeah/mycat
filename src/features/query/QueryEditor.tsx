import Editor, { type OnMount } from "@monaco-editor/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { listConnections } from "../connections/api";
import {
  executeSql,
  listDatabases,
  openConnection,
} from "../connections/sessionApi";
import type { ConnectionDto } from "../connections/types";
import { downloadTextFile } from "../import-export/csv";
import { useUiStore } from "../../stores/uiStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { formatSql, toggleLineComment } from "./sqlFormat";

type RunMode = "all" | "selection";

export function QueryEditor() {
  const theme = useUiStore((s) => s.theme);
  const activeQueryId = useWorkspaceStore((s) => s.activeQueryId);
  const queryTabs = useWorkspaceStore((s) => s.queryTabs);
  const updateQueryTab = useWorkspaceStore((s) => s.updateQueryTab);
  const applyQueryContext = useWorkspaceStore((s) => s.applyQueryContext);
  const tab = queryTabs.find((t) => t.id === activeQueryId) ?? null;

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const runRef = useRef<(mode: RunMode, explain?: boolean) => Promise<void>>(
    async () => undefined,
  );
  const saveRef = useRef<() => void>(() => undefined);
  const [connections, setConnections] = useState<ConnectionDto[]>([]);
  const [databases, setDatabases] = useState<string[]>([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [connMenuOpen, setConnMenuOpen] = useState(false);
  const [dbMenuOpen, setDbMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<{
    columns: string[];
    rows: unknown[][];
    rowsAffected: number;
    elapsedMs: number;
  } | null>(null);
  const [resultCollapsed, setResultCollapsed] = useState(false);

  const monacoTheme = useMemo(
    () => (theme === "dark" ? "vs-dark" : "light"),
    [theme],
  );

  useEffect(() => {
    void listConnections().then(setConnections).catch(() => setConnections([]));
  }, []);

  const loadDatabases = useCallback(
    async (connId: string, engine: string) => {
      setDbLoading(true);
      try {
        await openConnection(connId);
        if (engine === "sqlite") {
          const c = connections.find((x) => x.id === connId);
          const db = c?.host || "main";
          setDatabases([db]);
          return [db];
        }
        const dbs = await listDatabases(connId);
        setDatabases(dbs);
        return dbs;
      } catch {
        setDatabases([]);
        return [] as string[];
      } finally {
        setDbLoading(false);
      }
    },
    [connections],
  );

  // Keep workspace / inspector / tab title in sync with query context.
  useEffect(() => {
    if (!tab) return;
    const conn = connections.find((c) => c.id === tab.connectionId);
    if (!conn) return;
    applyQueryContext(conn, tab.database);
  }, [
    tab?.id,
    tab?.connectionId,
    tab?.database,
    connections,
    applyQueryContext,
  ]);

  useEffect(() => {
    if (!tab) return;
    void loadDatabases(tab.connectionId, tab.connectionEngine);
  }, [tab?.connectionId, tab?.connectionEngine, loadDatabases]);

  useEffect(() => {
    setError(null);
    setResult(null);
    setStatus(null);
    setRunMenuOpen(false);
    setConnMenuOpen(false);
    setDbMenuOpen(false);
  }, [tab?.id]);

  useEffect(() => {
    if (!connMenuOpen && !dbMenuOpen && !runMenuOpen) return;
    function onDoc() {
      setConnMenuOpen(false);
      setDbMenuOpen(false);
      setRunMenuOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [connMenuOpen, dbMenuOpen, runMenuOpen]);

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      void runRef.current("all");
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveRef.current();
    });
    editor.focus();
  };

  function patchSql(next: string) {
    if (!tab) return;
    updateQueryTab(tab.id, { sql: next, dirty: true });
  }

  function save() {
    if (!tab) return;
    const name =
      window
        .prompt(
          "保存查询为",
          tab.title === "无标题" ? "query.sql" : `${tab.title}.sql`,
        )
        ?.trim();
    if (!name) return;
    const filename = name.endsWith(".sql") ? name : `${name}.sql`;
    downloadTextFile(filename, tab.sql || "", "application/sql");
    updateQueryTab(tab.id, {
      title: filename.replace(/\.sql$/i, ""),
      dirty: false,
    });
    setStatus(`已保存 ${filename}`);
  }

  function beautify() {
    if (!tab) return;
    patchSql(formatSql(tab.sql));
  }

  function commentSelection() {
    if (!tab || !editorRef.current) return;
    const editor = editorRef.current;
    const sel = editor.getSelection();
    if (!sel) return;
    const next = toggleLineComment(
      tab.sql,
      sel.startLineNumber - 1,
      sel.endLineNumber - 1,
    );
    patchSql(next);
  }

  function findReplace() {
    editorRef.current?.getAction("actions.find")?.run();
  }

  async function switchConnection(connId: string) {
    if (!tab || connId === tab.connectionId) {
      setConnMenuOpen(false);
      return;
    }
    const conn = connections.find((c) => c.id === connId);
    if (!conn) return;
    setConnMenuOpen(false);
    setDbMenuOpen(false);
    const dbs = await loadDatabases(conn.id, String(conn.engine));
    let db = tab.database;
    if (!dbs.includes(db)) db = dbs[0] ?? "";
    updateQueryTab(tab.id, {
      connectionId: conn.id,
      connectionName: conn.name,
      connectionEngine: String(conn.engine),
      database: db,
      dirty: true,
    });
    applyQueryContext(conn, db);
  }

  async function switchDatabase(database: string) {
    if (!tab) return;
    setDbMenuOpen(false);
    const conn =
      connections.find((c) => c.id === tab.connectionId) ?? null;
    updateQueryTab(tab.id, { database, dirty: true });
    if (conn) applyQueryContext(conn, database);
    if (database && String(tab.connectionEngine) === "mysql") {
      try {
        await openConnection(tab.connectionId);
        await executeSql(
          tab.connectionId,
          `USE \`${database.replace(/`/g, "``")}\``,
        );
      } catch {
        // ignore — run() will retry USE
      }
    }
  }

  async function run(mode: RunMode, explain = false) {
    if (!tab) return;
    setRunMenuOpen(false);
    setRunning(true);
    setError(null);
    setStatus(null);
    setResult(null);
    try {
      await openConnection(tab.connectionId);
      if (tab.database && String(tab.connectionEngine) === "mysql") {
        await executeSql(
          tab.connectionId,
          `USE \`${tab.database.replace(/`/g, "``")}\``,
        );
      }
      let payload = tab.sql;
      if (mode === "selection") {
        const model = editorRef.current?.getModel();
        const sel = editorRef.current?.getSelection();
        if (model && sel && !sel.isEmpty()) {
          payload = model.getValueInRange(sel);
        } else {
          const browserSel = window.getSelection()?.toString()?.trim();
          if (browserSel) payload = browserSel;
        }
      }
      payload = payload.trim();
      if (!payload) {
        setError("没有可执行的 SQL");
        return;
      }
      if (explain) {
        payload = `EXPLAIN ${payload}`;
      }
      const out = await executeSql(tab.connectionId, payload);
      setResult(out);
      setStatus(
        `影响 ${out.rowsAffected} 行 · ${out.elapsedMs} ms · ${out.rows.length} 行结果`,
      );
      setResultCollapsed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  runRef.current = run;
  saveRef.current = save;

  if (!tab) {
    return (
      <div className="query-panel query-empty">
        <p className="pane-placeholder">
          点击顶栏「查询」或在数据库上选择「新建查询」开始编写 SQL。
        </p>
      </div>
    );
  }

  return (
    <div className="query-panel navicat-query">
      <div className="query-icon-bar">
        <div className="query-icon-group">
          <IconBtn title="保存" onClick={save}>
            <IconSave />
          </IconBtn>
          <span className="query-icon-sep" />
          <IconBtn title="格式化 SQL" onClick={beautify}>
            <IconWand />
          </IconBtn>
          <IconBtn title="注释" onClick={commentSelection}>
            <IconComment />
          </IconBtn>
          <IconBtn title="查找 / 替换" onClick={findReplace}>
            <IconSearch />
          </IconBtn>
        </div>
        <div className="query-icon-group">
          <IconBtn
            title={resultCollapsed ? "显示结果" : "隐藏结果"}
            onClick={() => setResultCollapsed((v) => !v)}
          >
            <IconPanel />
          </IconBtn>
        </div>
      </div>

      <div className="query-context-bar" onClick={(e) => e.stopPropagation()}>
        <div className={`query-ctx-dd ${connMenuOpen ? "is-open" : ""}`}>
          <button
            type="button"
            className="query-ctx-trigger"
            title="连接"
            onClick={() => {
              setDbMenuOpen(false);
              setRunMenuOpen(false);
              setConnMenuOpen((v) => !v);
            }}
          >
            <span className="query-ctx-icon is-conn" aria-hidden />
            <span className="query-ctx-label">{tab.connectionName}</span>
            <span className="query-ctx-caret" aria-hidden />
          </button>
          {connMenuOpen && (
            <div className="query-ctx-menu" role="listbox">
              {connections.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={c.id === tab.connectionId ? "is-active" : ""}
                  role="option"
                  aria-selected={c.id === tab.connectionId}
                  onClick={() => void switchConnection(c.id)}
                >
                  {c.id === tab.connectionId && (
                    <span className="query-ctx-check" aria-hidden>
                      ✓
                    </span>
                  )}
                  <span>{c.name}</span>
                </button>
              ))}
              {connections.length === 0 && (
                <div className="query-ctx-empty">暂无连接</div>
              )}
            </div>
          )}
        </div>

        <div className={`query-ctx-dd ${dbMenuOpen ? "is-open" : ""}`}>
          <button
            type="button"
            className="query-ctx-trigger"
            title="数据库"
            onClick={() => {
              setConnMenuOpen(false);
              setRunMenuOpen(false);
              setDbMenuOpen((v) => !v);
            }}
          >
            <span className="query-ctx-icon is-db" aria-hidden />
            <span className="query-ctx-label">
              {dbLoading ? "加载中…" : tab.database || "（未选择）"}
            </span>
            <span className="query-ctx-caret" aria-hidden />
          </button>
          {dbMenuOpen && (
            <div className="query-ctx-menu" role="listbox">
              {databases.map((db) => (
                <button
                  key={db}
                  type="button"
                  className={db === tab.database ? "is-active" : ""}
                  role="option"
                  aria-selected={db === tab.database}
                  onClick={() => void switchDatabase(db)}
                >
                  {db === tab.database && (
                    <span className="query-ctx-check" aria-hidden>
                      ✓
                    </span>
                  )}
                  <span>{db}</span>
                </button>
              ))}
              {tab.database && !databases.includes(tab.database) && (
                <button
                  type="button"
                  className="is-active"
                  onClick={() => void switchDatabase(tab.database)}
                >
                  <span className="query-ctx-check" aria-hidden>
                    ✓
                  </span>
                  <span>{tab.database}</span>
                </button>
              )}
              {!dbLoading && databases.length === 0 && (
                <div className="query-ctx-empty">无数据库</div>
              )}
            </div>
          )}
        </div>

        <div className="query-run-group">
          <button
            type="button"
            className="query-run-btn"
            disabled={running}
            onClick={() => void run("all")}
          >
            <span className="query-run-play" aria-hidden />
            运行
          </button>
          <button
            type="button"
            className="query-run-caret"
            disabled={running}
            aria-label="运行选项"
            onClick={() => {
              setConnMenuOpen(false);
              setDbMenuOpen(false);
              setRunMenuOpen((v) => !v);
            }}
          />
          {runMenuOpen && (
            <div className="query-run-menu">
              <button type="button" onClick={() => void run("all")}>
                运行全部
              </button>
              <button type="button" onClick={() => void run("selection")}>
                运行选中
              </button>
              <button type="button" onClick={() => void run("all", true)}>
                解释计划 (EXPLAIN)
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          className="query-stop-btn"
          disabled={!running}
          title="停止"
          onClick={() =>
            setStatus("当前为同步驱动，取消将在语句结束后生效（尽力中断）。")
          }
        >
          <span className="query-stop-icon" aria-hidden />
        </button>

        <button
          type="button"
          className="query-explain-btn"
          disabled={running}
          title="解释计划"
          onClick={() => void run("all", true)}
        >
          <span className="query-explain-icon" aria-hidden />
        </button>
      </div>

      <div className={`query-body ${resultCollapsed ? "is-result-collapsed" : ""}`}>
        <div className="query-editor">
          <Editor
            height="100%"
            defaultLanguage="sql"
            theme={monacoTheme}
            value={tab.sql}
            onChange={(v) => patchSql(v ?? "")}
            onMount={onMount}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: "on",
              glyphMargin: false,
              folding: true,
              wordWrap: "off",
              automaticLayout: true,
              scrollBeyondLastLine: false,
              renderLineHighlight: "line",
              padding: { top: 8 },
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
            }}
          />
        </div>

        {!resultCollapsed && (
          <div className="query-result">
            <div className="query-result-status">
              {error ? (
                <span className="is-error">{error}</span>
              ) : status ? (
                <span>{status}</span>
              ) : (
                <span className="is-muted">运行结果将显示在此处</span>
              )}
            </div>
            {result && (
              <div className="data-grid-scroll query-result-table">
                <table>
                  <thead>
                    <tr>
                      {result.columns.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j}>
                            {cell === null ? "NULL" : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {result.rows.length === 0 && (
                      <tr>
                        <td colSpan={Math.max(result.columns.length, 1)}>
                          （无行）
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="query-icon-btn" title={title} onClick={onClick}>
      {children}
    </button>
  );
}

function IconSave() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 2.5h8.5L13.5 5v8.5H3V2.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M5 2.5v4h5v-4" stroke="currentColor" strokeWidth="1.2" />
      <rect x="5" y="9.5" width="6" height="4" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function IconWand() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 13 11.5 4.5" stroke="#3b82f6" strokeWidth="1.4" />
      <path d="M10 3.5 12.5 6" stroke="#3b82f6" strokeWidth="1.4" />
      <path d="M12 2.5v2M13.5 4h-2M4.5 10v2M6 11.5H4" stroke="#f59e0b" strokeWidth="1.2" />
    </svg>
  );
}

function IconComment() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 3.5h10v7H8l-2.5 2v-2H3v-7Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M5.5 6.5h5M5.5 8.5h3.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10 10.5 13 13.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function IconPanel() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.5 10h11" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

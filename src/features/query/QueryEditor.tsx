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
  fetchTablePage,
  listDatabases,
  listTables,
  openConnection,
} from "../connections/sessionApi";
import type { ConnectionDto } from "../connections/types";
import { Splitter } from "../../shell/Splitter";
import { useUiStore } from "../../stores/uiStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import {
  QueryResultPanel,
  type QueryBatchItem,
} from "./QueryResultPanel";
import { upsertSavedQuery } from "./savedQueriesApi";
import {
  isTableNameContext,
  registerSqlCompletions,
  setSqlCompletionContext,
} from "./sqlCompletions";
import { formatSql, toggleLineComment } from "./sqlFormat";
import {
  jsonFromExplainResult,
  wrapExplainSql,
} from "./explainPlan";
import {
  isExplainSql,
  splitSqlStatements,
  statementAtOffset,
} from "./sqlSplit";

type RunMode = "all" | "selection" | "current";

export function QueryEditor() {
  const theme = useUiStore((s) => s.theme);
  const queryEditorRatio = useUiStore((s) => s.layout.queryEditorRatio);
  const bumpQueryEditorRatioByPx = useUiStore(
    (s) => s.bumpQueryEditorRatioByPx,
  );
  const queryBodyRef = useRef<HTMLDivElement>(null);
  const activeQueryId = useWorkspaceStore((s) => s.activeQueryId);
  const queryTabs = useWorkspaceStore((s) => s.queryTabs);
  const updateQueryTab = useWorkspaceStore((s) => s.updateQueryTab);
  const applyQueryContext = useWorkspaceStore((s) => s.applyQueryContext);
  const tab = queryTabs.find((t) => t.id === activeQueryId) ?? null;

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const runRef = useRef<(mode: RunMode, explain?: boolean) => Promise<void>>(
    async () => undefined,
  );
  const runSmartRef = useRef<(explain?: boolean) => Promise<void>>(
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
  const [batchItems, setBatchItems] = useState<QueryBatchItem[]>([]);
  const [batchMessages, setBatchMessages] = useState<string[]>([]);
  const [resultCollapsed, setResultCollapsed] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findMatchCase, setFindMatchCase] = useState(false);
  const [findIndex, setFindIndex] = useState(0);
  const [findCount, setFindCount] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveAsMode, setSaveAsMode] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const saveNameInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | null>(null);

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

  // Refresh autocomplete metadata for current connection/database.
  useEffect(() => {
    if (!tab?.connectionId) {
      setSqlCompletionContext({
        connectionId: null,
        database: null,
        engine: null,
        tables: [],
        columnsByTable: {},
      });
      return;
    }
    let cancelled = false;
    async function loadMeta() {
      try {
        await openConnection(tab!.connectionId);
        if (tab!.database && String(tab!.connectionEngine) === "mysql") {
          try {
            await executeSql(
              tab!.connectionId,
              `USE \`${tab!.database.replace(/`/g, "``")}\``,
            );
          } catch {
            // ignore
          }
        }
        const tables = await listTables(
          tab!.connectionId,
          tab!.database || undefined,
        );
        if (cancelled) return;
        // Publish tables immediately so FROM autocomplete works without waiting columns.
        setSqlCompletionContext({
          connectionId: tab!.connectionId,
          database: tab!.database || null,
          engine: tab!.connectionEngine,
          tables: tables.map((t) => ({ name: t.name, kind: t.kind })),
          columnsByTable: {},
        });
        const columnsByTable: Record<string, string[]> = {};
        const sample = tables.slice(0, 40);
        await Promise.all(
          sample.map(async (t) => {
            try {
              const page = await fetchTablePage({
                connectionId: tab!.connectionId,
                table: t.name,
                page: 1,
                pageSize: 1,
              });
              columnsByTable[t.name] = page.columns.map((c) => c.name);
            } catch {
              columnsByTable[t.name] = [];
            }
          }),
        );
        if (cancelled) return;
        setSqlCompletionContext({
          connectionId: tab!.connectionId,
          database: tab!.database || null,
          engine: tab!.connectionEngine,
          tables: tables.map((t) => ({ name: t.name, kind: t.kind })),
          columnsByTable,
        });
      } catch {
        if (!cancelled) {
          setSqlCompletionContext({
            connectionId: tab!.connectionId,
            database: tab!.database || null,
            engine: tab!.connectionEngine,
            tables: [],
            columnsByTable: {},
          });
        }
      }
    }
    void loadMeta();
    return () => {
      cancelled = true;
    };
  }, [tab?.connectionId, tab?.database, tab?.connectionEngine]);

  useEffect(() => {
    setError(null);
    setBatchItems([]);
    setBatchMessages([]);
    setStatus(null);
    setRunMenuOpen(false);
    setConnMenuOpen(false);
    setDbMenuOpen(false);
    setFindOpen(false);
    setFindQuery("");
    setFindCount(0);
    setFindIndex(0);
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

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }

  // Global ⌘/Ctrl+S — Tauri/WebView may not route browser save; Monaco alone
  // only fires when the editor has focus. ⇧⌘S = 另存为.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key.toLowerCase() !== "s") return;
      if (!tab) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) openSaveDialog(true);
      else saveRef.current();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    registerSqlCompletions(monaco);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      void runSmartRef.current();
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveRef.current();
    });
    // Use our Find bar instead of Monaco's (Monaco close icon often broken).
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
      void editor.getAction("closeFindWidget")?.run();
      setFindOpen(true);
      window.setTimeout(() => findInputRef.current?.focus(), 0);
    });
    editor.addCommand(monaco.KeyCode.Escape, () => {
      void editor.getAction("closeFindWidget")?.run();
      setFindOpen(false);
    });
    editor.addCommand(
      monaco.KeyMod.Shift | monaco.KeyCode.Escape,
      () => {
        void editor.getAction("closeFindWidget")?.run();
        setFindOpen(false);
      },
    );
    // Auto-open suggestions: keywords, and table names after FROM/JOIN/…
    let suggestTimer: number | undefined;
    editor.onDidChangeModelContent(() => {
      window.clearTimeout(suggestTimer);
      suggestTimer = window.setTimeout(() => {
        const sel = editor.getSelection();
        if (!sel || !sel.isEmpty()) return;
        const model = editor.getModel();
        if (!model) return;
        const pos = sel.getPosition();
        const word = model.getWordUntilPosition(pos).word;
        const want =
          (/^[A-Za-z_][\w]*$/.test(word) && word.length >= 1) ||
          isTableNameContext(model, pos);
        if (want) {
          void editor.trigger("sql-suggest", "editor.action.triggerSuggest", {});
        }
      }, 60);
    });
    editor.focus();
  };

  function patchSql(next: string) {
    if (!tab) return;
    updateQueryTab(tab.id, { sql: next, dirty: true });
  }

  function openSaveDialog(saveAs = false) {
    if (!tab) return;
    // Already linked: overwrite without rename prompt (Navicat Save).
    if (
      !saveAs &&
      tab.savedQueryId &&
      tab.title &&
      tab.title !== "无标题"
    ) {
      void persistSave(tab.title, false);
      return;
    }
    const suggested =
      tab.title && tab.title !== "无标题"
        ? saveAs
          ? `${tab.title} 副本`
          : tab.title
        : "未命名查询";
    setSaveAsMode(saveAs);
    setSaveName(suggested);
    setSaveDialogOpen(true);
    window.setTimeout(() => {
      saveNameInputRef.current?.focus();
      saveNameInputRef.current?.select();
    }, 0);
  }

  async function persistSave(rawName: string, saveAs = saveAsMode) {
    if (!tab) return;
    const title = rawName.trim().replace(/\.sql$/i, "");
    if (!title) return;
    setSaveBusy(true);
    setError(null);
    try {
      const saved = await upsertSavedQuery({
        id: saveAs ? undefined : tab.savedQueryId || undefined,
        connectionId: tab.connectionId,
        database: tab.database || null,
        name: title,
        sql: tab.sql || "",
      });
      updateQueryTab(tab.id, {
        title: saved.name,
        savedQueryId: saved.id,
        dirty: false,
      });
      setSaveDialogOpen(false);
      setSaveAsMode(false);
      const msg = `已保存到「查询」：${saved.name}`;
      setStatus(msg);
      showToast(msg);
      window.dispatchEvent(
        new CustomEvent("saved-queries-changed", {
          detail: { connectionId: tab.connectionId, database: tab.database },
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaveBusy(false);
    }
  }

  function save() {
    openSaveDialog(false);
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

  function closeFind() {
    const editor = editorRef.current;
    void editor?.getAction("closeFindWidget")?.run();
    // Monaco internal contribution (best-effort).
    try {
      const contrib = editor?.getContribution?.(
        "editor.contrib.findController",
      ) as { closeFindWidget?: () => void } | null;
      contrib?.closeFindWidget?.();
    } catch {
      // ignore
    }
    setFindOpen(false);
    setFindCount(0);
    setFindIndex(0);
    editor?.focus();
  }

  function findReplace() {
    // Always prefer our controllable Find bar with a real × button.
    const editor = editorRef.current;
    void editor?.getAction("closeFindWidget")?.run();
    setFindOpen((open) => {
      const next = !open;
      if (next) window.setTimeout(() => findInputRef.current?.focus(), 0);
      return next;
    });
  }

  function runFind(direction: "next" | "prev" | "fresh" = "fresh") {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !findQuery) {
      setFindCount(0);
      setFindIndex(0);
      return;
    }
    const matches = model.findMatches(
      findQuery,
      true,
      false,
      findMatchCase,
      null,
      true,
    );
    setFindCount(matches.length);
    if (matches.length === 0) {
      setFindIndex(0);
      return;
    }
    let idx = findIndex;
    if (direction === "fresh") {
      const pos = editor.getPosition();
      idx = 0;
      if (pos) {
        const found = matches.findIndex(
          (m) =>
            m.range.startLineNumber > pos.lineNumber ||
            (m.range.startLineNumber === pos.lineNumber &&
              m.range.startColumn >= pos.column),
        );
        idx = found >= 0 ? found : 0;
      }
    } else if (direction === "next") {
      idx = (findIndex + 1) % matches.length;
    } else {
      idx = (findIndex - 1 + matches.length) % matches.length;
    }
    const match = matches[idx]!;
    setFindIndex(idx);
    editor.setSelection(match.range);
    editor.revealRangeInCenter(match.range);
  }

  useEffect(() => {
    if (!findOpen) return;
    runFind("fresh");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findQuery, findMatchCase, findOpen, tab?.id]);

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
    });
    applyQueryContext(conn, db);
  }

  async function switchDatabase(database: string) {
    if (!tab) return;
    setDbMenuOpen(false);
    const conn =
      connections.find((c) => c.id === tab.connectionId) ?? null;
    updateQueryTab(tab.id, { database });
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

  function getSelectedSql(): string {
    const model = editorRef.current?.getModel();
    const sel = editorRef.current?.getSelection();
    if (model && sel && !sel.isEmpty()) {
      return model.getValueInRange(sel);
    }
    return "";
  }

  function getCurrentStatementSql(): string {
    const model = editorRef.current?.getModel();
    const pos = editorRef.current?.getPosition();
    if (!model || !pos) {
      const stmts = splitSqlStatements(tab?.sql ?? "");
      return stmts[0] ?? (tab?.sql ?? "").trim();
    }
    const offset = model.getOffsetAt(pos);
    return (
      statementAtOffset(model.getValue(), offset) ||
      getSelectedSql() ||
      model.getValue().trim()
    );
  }

  /**
   * Main Run:
   * - 有选中 → 执行选中（可多语句 → 多结果）
   * - 无选中 → 执行编辑器全部语句（多语句 → 多结果）
   */
  async function runSmart(explain = false) {
    const selected = getSelectedSql().trim();
    if (selected) {
      await run("selection", explain);
    } else {
      await run("all", explain);
    }
  }

  async function run(mode: RunMode, explain = false) {
    if (!tab) return;
    setRunMenuOpen(false);
    setRunning(true);
    setError(null);
    setStatus(null);
    setBatchItems([]);
    setBatchMessages([]);
    try {
      await openConnection(tab.connectionId);
      if (tab.database && String(tab.connectionEngine) === "mysql") {
        await executeSql(
          tab.connectionId,
          `USE \`${tab.database.replace(/`/g, "``")}\``,
        );
      }

      let script = "";
      if (mode === "selection") {
        script = getSelectedSql().trim();
        if (!script) {
          setError("请先选中要执行的 SQL 行/语句");
          return;
        }
      } else if (mode === "current") {
        script = getCurrentStatementSql().trim();
      } else {
        script = tab.sql.trim();
      }

      if (!script) {
        setError("没有可执行的 SQL");
        return;
      }

      let statements = splitSqlStatements(script);
      if (statements.length === 0) statements = [script];
      // Ignore empty / comment-only leftovers
      statements = statements
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !/^(--|#|\/\*)/.test(s));
      if (statements.length === 0) {
        setError("没有可执行的 SQL");
        return;
      }
      const engine = String(tab.connectionEngine || "mysql");
      const doExplain = explain;

      const items: QueryBatchItem[] = [];
      const messages: string[] = [
        `${doExplain ? "解释" : "执行"} ${statements.length} 条语句 · ${mode === "selection" ? "选中内容" : mode === "current" ? "当前语句" : "全部"}`,
      ];

      for (let i = 0; i < statements.length; i++) {
        const original = statements[i]!;
        const id = `stmt-${Date.now()}-${i}`;
        const asExplain = doExplain || isExplainSql(original);
        try {
          if (asExplain) {
            const jsonSql = wrapExplainSql(original, engine, "json");
            const gridSql = wrapExplainSql(original, engine, "traditional");
            let explainJson: string | undefined;
            let explainGrid: QueryBatchItem["explainGrid"];
            let elapsed = 0;
            let primary = original;

            try {
              const jsonOut = await executeSql(tab.connectionId, jsonSql);
              elapsed += jsonOut.elapsedMs;
              primary = jsonSql;
              const raw = jsonFromExplainResult(jsonOut.columns, jsonOut.rows);
              if (raw) explainJson = raw;
              // If JSON format not available, treat tabular as grid
              if (!raw && jsonOut.columns.length > 0) {
                explainGrid = jsonOut;
              }
            } catch {
              /* fall through to traditional */
            }

            if (gridSql !== jsonSql || !explainGrid) {
              try {
                const gridOut = await executeSql(tab.connectionId, gridSql);
                elapsed += gridOut.elapsedMs;
                if (!primary.startsWith("EXPLAIN")) primary = gridSql;
                if (gridOut.columns.length > 0) explainGrid = gridOut;
                if (!explainJson) {
                  const raw = jsonFromExplainResult(
                    gridOut.columns,
                    gridOut.rows,
                  );
                  if (raw) explainJson = raw;
                }
              } catch (err) {
                if (!explainJson && !explainGrid) throw err;
              }
            }

            items.push({
              id,
              sql: primary,
              kind: "explain",
              result: explainGrid,
              explainGrid,
              explainJson,
              elapsedMs: elapsed,
            });
            messages.push(
              `[${i + 1}/${statements.length}] EXPLAIN OK · ${elapsed} ms`,
            );
          } else {
            const out = await executeSql(tab.connectionId, original);
            const hasGrid = out.columns.length > 0;
            items.push({
              id,
              sql: original,
              kind: hasGrid ? "result" : "message",
              result: hasGrid ? out : undefined,
              elapsedMs: out.elapsedMs,
            });
            messages.push(
              hasGrid
                ? `[${i + 1}/${statements.length}] OK · ${out.rows.length} 行 · ${out.elapsedMs} ms`
                : `[${i + 1}/${statements.length}] OK · 影响 ${out.rowsAffected} 行 · ${out.elapsedMs} ms`,
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          items.push({ id, sql: original, kind: "message", error: msg });
          messages.push(`[${i + 1}/${statements.length}] ERROR: ${msg}`);
        }
      }

      setBatchItems(items);
      setBatchMessages(messages);
      const ok = items.filter((x) => !x.error).length;
      const fail = items.filter((x) => x.error).length;
      const resultCount = items.filter(
        (x) => (x.kind === "result" || x.kind === "explain") && x.result,
      ).length;
      setStatus(
        `完成：成功 ${ok} · 失败 ${fail} · 结果集 ${resultCount}`,
      );
      setResultCollapsed(false);
      if (fail && ok === 0) {
        setError(items.find((x) => x.error)?.error ?? "执行失败");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  // Keep ref signature compatible with Ctrl/Cmd+Enter → smart run
  async function runFromShortcut(mode: RunMode, explain = false) {
    if (mode === "all") await run("all", explain);
    else await runSmart(explain);
  }

  runRef.current = runFromShortcut;
  runSmartRef.current = runSmart;
  saveRef.current = () => {
    void save();
  };

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
    <>
    <div className="query-panel navicat-query">
      {toast ? (
        <div className="query-toast" role="status">
          {toast}
        </div>
      ) : null}
      <div className="query-icon-bar">
        <div className="query-icon-group">
          <IconBtn title="保存查询 (⌘/Ctrl+S)" onClick={save}>
            <IconSave />
          </IconBtn>
          <IconBtn
            title="另存为 (⇧⌘/Ctrl+S)"
            onClick={() => openSaveDialog(true)}
          >
            <IconSaveAs />
          </IconBtn>
          <span className="query-icon-sep" />
          <IconBtn title="格式化 SQL" onClick={beautify}>
            <IconWand />
          </IconBtn>
          <IconBtn title="注释" onClick={commentSelection}>
            <IconComment />
          </IconBtn>
          <IconBtn title="查找 (⌘/Ctrl+F)" onClick={findReplace}>
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

      {findOpen && (
        <div className="query-find-bar" onClick={(e) => e.stopPropagation()}>
          <input
            ref={findInputRef}
            className="query-find-input"
            value={findQuery}
            placeholder="Find"
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                closeFind();
              } else if (e.key === "Enter") {
                e.preventDefault();
                runFind(e.shiftKey ? "prev" : "next");
              }
            }}
          />
          <button
            type="button"
            className={`query-find-opt ${findMatchCase ? "is-on" : ""}`}
            title="区分大小写"
            onClick={() => setFindMatchCase((v) => !v)}
          >
            Aa
          </button>
          <span className="query-find-status">
            {findQuery
              ? findCount === 0
                ? "No results"
                : `${findIndex + 1} of ${findCount}`
              : ""}
          </span>
          <button
            type="button"
            className="query-find-nav"
            title="上一个"
            onClick={() => runFind("prev")}
          >
            ▲
          </button>
          <button
            type="button"
            className="query-find-nav"
            title="下一个"
            onClick={() => runFind("next")}
          >
            ▼
          </button>
          <button
            type="button"
            className="query-find-close"
            title="关闭查找 (Esc)"
            aria-label="关闭查找"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              closeFind();
            }}
          >
            ×
          </button>
        </div>
      )}

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
            onClick={() => void runSmart()}
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
                运行全部（多结果）
              </button>
              <button type="button" onClick={() => void run("selection")}>
                运行选中（多结果）
              </button>
              <button type="button" onClick={() => void run("current")}>
                仅运行当前语句
              </button>
              <button type="button" onClick={() => void runSmart(true)}>
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
            showToast(
              "暂不支持中途取消：请等待当前语句执行结束（后端同步驱动）。",
            )
          }
        >
          <span className="query-stop-icon" aria-hidden />
        </button>

        <button
          type="button"
          className="query-explain-btn"
          disabled={running}
          title="解释 (可视化执行计划)"
          aria-label="解释"
          onClick={() => void runSmart(true)}
        >
          <IconExplain />
        </button>
      </div>

      <div
        ref={queryBodyRef}
        className={`query-body ${resultCollapsed ? "is-result-collapsed" : ""}`}
        style={
          resultCollapsed
            ? undefined
            : {
                gridTemplateRows: `minmax(120px, ${queryEditorRatio}fr) 5px minmax(100px, ${1 - queryEditorRatio}fr)`,
              }
        }
      >
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
              quickSuggestions: {
                other: true,
                comments: false,
                strings: false,
              },
              suggestOnTriggerCharacters: true,
              wordBasedSuggestions: "off",
              tabCompletion: "on",
              snippetSuggestions: "inline",
              suggest: {
                showKeywords: true,
                showSnippets: true,
                preview: true,
                insertMode: "replace",
              },
            }}
          />
        </div>

        {!resultCollapsed && (
          <Splitter
            orientation="horizontal"
            title="拖动调整编辑区 / 结果区高度"
            onDrag={(delta) => {
              const h = queryBodyRef.current?.clientHeight ?? 0;
              bumpQueryEditorRatioByPx(delta, h);
            }}
          />
        )}

        {!resultCollapsed && (
          <div className="query-result">
            {batchItems.length > 0 ? (
              <QueryResultPanel
                items={batchItems}
                messages={batchMessages}
                tableHint={
                  tab.database ? `${tab.database}_result` : "query_result"
                }
              />
            ) : (
              <div className="query-result-status">
                {error ? (
                  <span className="is-error">{error}</span>
                ) : status ? (
                  <span>{status}</span>
                ) : (
                  <span className="is-muted">
                    点「运行」执行全部语句（或选中部分）。多条 SELECT 会生成「结果 1」「结果 2」… 页签。
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>

    {saveDialogOpen && (
      <div
        className="modal-backdrop"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !saveBusy) {
            setSaveDialogOpen(false);
          }
        }}
      >
        <form
          className="modal"
          onSubmit={(e) => {
            e.preventDefault();
            void persistSave(saveName);
          }}
        >
          <h2>{saveAsMode ? "另存为查询" : "保存查询"}</h2>
          <label>
            查询名称
            <input
              ref={saveNameInputRef}
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="未命名查询"
              disabled={saveBusy}
              autoComplete="off"
            />
          </label>
          <p className="save-query-hint">
            {saveAsMode
              ? "将创建为新的已保存查询，不影响原查询。"
              : "保存后可在左侧对象树「查询」中打开。"}
          </p>
          <div className="modal-actions">
            <button
              type="button"
              disabled={saveBusy}
              onClick={() => setSaveDialogOpen(false)}
            >
              取消
            </button>
            <button type="submit" disabled={saveBusy || !saveName.trim()}>
              {saveBusy ? "保存中…" : "保存"}
            </button>
          </div>
        </form>
      </div>
    )}
    </>
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

function IconSaveAs() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 2.5h7.5L12.5 5v8.5H2.5V2.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M4.5 2.5v3.5h5V2.5" stroke="currentColor" strokeWidth="1.2" />
      <rect
        x="4.5"
        y="9.5"
        width="5"
        height="3.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M12.5 8.5h3M14 7v3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Navicat-style explain / visual plan icon (flowchart). */
function IconExplain() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="5" y="1.5" width="6" height="3.2" rx="0.6" stroke="#3b82f6" strokeWidth="1.2" />
      <rect x="1.5" y="11.3" width="5" height="3.2" rx="0.6" stroke="#3b82f6" strokeWidth="1.2" />
      <rect x="9.5" y="11.3" width="5" height="3.2" rx="0.6" stroke="#3b82f6" strokeWidth="1.2" />
      <path
        d="M8 4.7v2.4M8 7.1H4V11.3M8 7.1h4V11.3"
        stroke="#3b82f6"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
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

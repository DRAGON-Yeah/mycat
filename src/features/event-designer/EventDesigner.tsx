import Editor from "@monaco-editor/react";
import { useEffect, useMemo, useState } from "react";
import { executeSql, openConnection } from "../connections/sessionApi";
import { identOk } from "../nav-tree/sqlIdent";
import { dropEvent, fetchEventDdl } from "../nav-tree/eventMenuActions";
import { emitTableDataChanged } from "../../lib/tableEvents";
import { useWorkspaceStore, type DesignerTab } from "../../stores/workspaceStore";
import { useModSaveShortcut } from "../../hooks/useModSaveShortcut";
import {
  buildCreateEventSql,
  EVENT_INTERVAL_UNITS,
  parseEventDdl,
  splitIntervalExpr,
  type EventIntervalUnit,
  type EventScheduleKind,
} from "./eventDdl";

type Props = { tab: DesignerTab };
type Pane = "definition" | "schedule" | "comment" | "preview";
type PreviewMode = "change" | "ddl";
type StatusValue = "ENABLE" | "DISABLE" | "DISABLE ON SLAVE";

const TABS: { id: Pane; label: string }[] = [
  { id: "definition", label: "定义" },
  { id: "schedule", label: "计划" },
  { id: "comment", label: "注释" },
  { id: "preview", label: "SQL 预览" },
];

export function EventDesigner({ tab }: Props) {
  const markDirty = useWorkspaceStore((s) => s.markDesignerDirty);
  const updateDesignerTab = useWorkspaceStore((s) => s.updateDesignerTab);
  const promoteDesignerToAlter = useWorkspaceStore(
    (s) => s.promoteDesignerToAlter,
  );
  const activeConnection = useWorkspaceStore((s) => s.activeConnection);

  const [pane, setPane] = useState<Pane>("definition");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("change");
  const [name, setName] = useState(
    tab.mode === "create" ? "Untitled" : tab.table || "Untitled",
  );
  const [definer, setDefiner] = useState("");
  const [status, setStatus] = useState<StatusValue>("ENABLE");
  const [onCompletion, setOnCompletion] = useState<
    "PRESERVE" | "NOT PRESERVE"
  >("NOT PRESERVE");
  const [comment, setComment] = useState("");

  const [scheduleKind, setScheduleKind] = useState<EventScheduleKind>("AT");
  const [atDatetime, setAtDatetime] = useState("CURRENT_TIMESTAMP");
  const [atIntervalOn, setAtIntervalOn] = useState(false);
  const [atIntervalValue, setAtIntervalValue] = useState("1");
  const [atIntervalUnit, setAtIntervalUnit] =
    useState<EventIntervalUnit>("HOUR");

  const [everyValue, setEveryValue] = useState("1");
  const [everyUnit, setEveryUnit] = useState<EventIntervalUnit>("DAY");
  const [startsOn, setStartsOn] = useState(false);
  const [starts, setStarts] = useState("CURRENT_TIMESTAMP");
  const [startsIntervalOn, setStartsIntervalOn] = useState(false);
  const [startsIntervalValue, setStartsIntervalValue] = useState("1");
  const [startsIntervalUnit, setStartsIntervalUnit] =
    useState<EventIntervalUnit>("HOUR");
  const [endsOn, setEndsOn] = useState(false);
  const [ends, setEnds] = useState("CURRENT_TIMESTAMP");
  const [endsIntervalOn, setEndsIntervalOn] = useState(false);
  const [endsIntervalValue, setEndsIntervalValue] = useState("1");
  const [endsIntervalUnit, setEndsIntervalUnit] =
    useState<EventIntervalUnit>("DAY");

  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(tab.mode === "alter");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const conn =
    activeConnection?.id === tab.connectionId ? activeConnection : null;
  const engine = tab.connectionEngine;
  const isMysql = /mysql|mariadb/i.test(String(engine));

  useEffect(() => {
    if (tab.mode !== "alter") return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        if (!conn) throw new Error("连接不可用");
        if (!isMysql) throw new Error("当前引擎不支持 MySQL 事件");
        const ddl = await fetchEventDdl({
          conn,
          database: tab.database,
          name: tab.table,
        });
        if (cancelled) return;
        const p = parseEventDdl(ddl);
        setName(p.name || tab.table);
        setDefiner(p.definer);
        setStatus(p.status);
        setOnCompletion(p.onCompletion);
        setComment(p.comment);
        setScheduleKind(p.scheduleKind);
        // Parse AT … + INTERVAL
        const atSrc = p.atDatetime || "CURRENT_TIMESTAMP";
        const atInt = atSrc.match(
          /^(.+?)\s*\+\s*INTERVAL\s+(\d+(?:\.\d+)?)\s+([A-Za-z_]+)$/i,
        );
        if (atInt) {
          setAtDatetime(atInt[1]!.trim());
          setAtIntervalOn(true);
          setAtIntervalValue(atInt[2]!);
          setAtIntervalUnit(atInt[3]!.toUpperCase() as EventIntervalUnit);
        } else {
          setAtDatetime(atSrc || "CURRENT_TIMESTAMP");
          setAtIntervalOn(false);
        }
        const ev = splitIntervalExpr(p.everyExpr || "1 DAY");
        setEveryValue(ev.value);
        setEveryUnit(ev.unit);
        if (p.starts) {
          setStartsOn(true);
          const si = p.starts.match(
            /^(.+?)\s*\+\s*INTERVAL\s+(\d+(?:\.\d+)?)\s+([A-Za-z_]+)$/i,
          );
          if (si) {
            setStarts(si[1]!.trim());
            setStartsIntervalOn(true);
            setStartsIntervalValue(si[2]!);
            setStartsIntervalUnit(
              si[3]!.toUpperCase() as EventIntervalUnit,
            );
          } else {
            setStarts(p.starts);
          }
        } else {
          setStartsOn(false);
        }
        if (p.ends) {
          setEndsOn(true);
          const ei = p.ends.match(
            /^(.+?)\s*\+\s*INTERVAL\s+(\d+(?:\.\d+)?)\s+([A-Za-z_]+)$/i,
          );
          if (ei) {
            setEnds(ei[1]!.trim());
            setEndsIntervalOn(true);
            setEndsIntervalValue(ei[2]!);
            setEndsIntervalUnit(ei[3]!.toUpperCase() as EventIntervalUnit);
          } else {
            setEnds(p.ends);
          }
        } else {
          setEndsOn(false);
        }
        setBody(p.body === "BEGIN\n\nEND" ? "" : p.body);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab.id, tab.mode, tab.table, tab.database, conn, isMysql]);

  function touchDirty() {
    if (!tab.dirty) markDirty(tab.id, true);
  }

  const previewSql = useMemo(() => {
    try {
      return buildCreateEventSql({
        engine,
        database: tab.database,
        name: name.trim() || "Untitled",
        status,
        onCompletion,
        definer,
        comment,
        scheduleKind,
        atDatetime,
        atIntervalEnabled: atIntervalOn,
        atIntervalValue,
        atIntervalUnit,
        everyValue,
        everyUnit,
        startsEnabled: startsOn,
        starts,
        startsIntervalEnabled: startsIntervalOn,
        startsIntervalValue,
        startsIntervalUnit,
        endsEnabled: endsOn,
        ends,
        endsIntervalEnabled: endsIntervalOn,
        endsIntervalValue,
        endsIntervalUnit,
        body,
      });
    } catch (err) {
      return `-- ${err instanceof Error ? err.message : String(err)}`;
    }
  }, [
    engine,
    tab.database,
    name,
    status,
    onCompletion,
    definer,
    comment,
    scheduleKind,
    atDatetime,
    atIntervalOn,
    atIntervalValue,
    atIntervalUnit,
    everyValue,
    everyUnit,
    startsOn,
    starts,
    startsIntervalOn,
    startsIntervalValue,
    startsIntervalUnit,
    endsOn,
    ends,
    endsIntervalOn,
    endsIntervalValue,
    endsIntervalUnit,
    body,
  ]);

  async function save() {
    const n = name.trim() || "Untitled";
    if (!identOk(n)) {
      setError("名称仅允许字母、数字、下划线，且不能以数字开头");
      setPane("definition");
      return;
    }
    if (!conn) {
      setError("连接不可用");
      return;
    }
    if (!isMysql) {
      setError("当前引擎不支持保存事件");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const sql = previewSql;
      await openConnection(conn.id);
      if (tab.mode === "alter") {
        await dropEvent({
          conn,
          database: tab.database,
          name: tab.table,
        });
      }
      await executeSql(conn.id, sql, tab.database);
      updateDesignerTab(tab.id, { table: n, dirty: false });
      if (tab.mode === "create") {
        promoteDesignerToAlter(tab.id, n);
      }
      emitTableDataChanged({
        connectionId: tab.connectionId,
        database: tab.database,
        table: n,
      });
      window.dispatchEvent(new Event("mycat:object-list-refresh"));
      setMessage(`已保存事件 ${n}`);
      markDirty(tab.id, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  useModSaveShortcut(() => {
    if (!loading && !saving) void save();
  });

  const atActive = scheduleKind === "AT";
  const everyActive = scheduleKind === "EVERY";

  return (
    <div className="event-designer-navicat">
      <div className="ev-toolbar">
        <button
          type="button"
          className="ev-save-btn"
          title="保存 (⌘S)"
          disabled={loading || saving}
          onClick={() => void save()}
          aria-label="保存"
        >
          💾
        </button>
        {tab.mode === "create" && (
          <input
            className="ev-name-input"
            value={name}
            title="事件名"
            onChange={(e) => {
              setName(e.target.value);
              touchDirty();
            }}
          />
        )}
        {tab.mode === "alter" && (
          <span className="ev-name-label" title={name}>
            {name}
          </span>
        )}
        <div className="ev-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`ev-tab ${pane === t.id ? "is-active" : ""}`}
              onClick={() => setPane(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ev-toolbar-spacer" />
      </div>

      {error && <p className="pane-error">{error}</p>}
      {message && <p className="pane-ok">{message}</p>}

      {loading ? (
        <p className="pane-placeholder">加载事件定义…</p>
      ) : (
        <div className="ev-body">
          {pane === "definition" && (
            <div className="ev-pane-definition">
              <div className="ev-editor-wrap">
                <Editor
                  height="100%"
                  defaultLanguage="sql"
                  theme="vs"
                  value={body}
                  onChange={(v) => {
                    setBody(v ?? "");
                    touchDirty();
                  }}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    wordWrap: "on",
                    automaticLayout: true,
                    scrollBeyondLastLine: false,
                    lineNumbers: "on",
                  }}
                />
              </div>
              <div className="ev-def-footer">
                <label className="ev-footer-field">
                  <span>定义者</span>
                  <input
                    value={definer}
                    placeholder="user@host"
                    onChange={(e) => {
                      setDefiner(e.target.value);
                      touchDirty();
                    }}
                  />
                </label>
                <label className="ev-footer-field">
                  <span>状态</span>
                  <select
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value as StatusValue);
                      touchDirty();
                    }}
                  >
                    <option value="ENABLE">ENABLE</option>
                    <option value="DISABLE">DISABLE</option>
                    <option value="DISABLE ON SLAVE">DISABLE ON SLAVE</option>
                  </select>
                </label>
                <label className="ev-footer-field">
                  <span>退出时</span>
                  <select
                    value={onCompletion}
                    onChange={(e) => {
                      setOnCompletion(
                        e.target.value as "PRESERVE" | "NOT PRESERVE",
                      );
                      touchDirty();
                    }}
                  >
                    <option value="NOT PRESERVE">NOT PRESERVE</option>
                    <option value="PRESERVE">PRESERVE</option>
                  </select>
                </label>
              </div>
            </div>
          )}

          {pane === "schedule" && (
            <div className="ev-pane-schedule">
              <div className={`ev-sched-row ${atActive ? "" : "is-dim"}`}>
                <label className="ev-radio">
                  <input
                    type="radio"
                    name="ev-sched"
                    checked={atActive}
                    onChange={() => {
                      setScheduleKind("AT");
                      touchDirty();
                    }}
                  />
                  <span>AT</span>
                </label>
                <input
                  className="ev-sched-main"
                  value={atDatetime}
                  disabled={!atActive}
                  onChange={(e) => {
                    setAtDatetime(e.target.value);
                    touchDirty();
                  }}
                />
              </div>
              <div className={`ev-sched-indent ${atActive ? "" : "is-dim"}`}>
                <label className="ev-check">
                  <input
                    type="checkbox"
                    checked={atIntervalOn}
                    disabled={!atActive}
                    onChange={(e) => {
                      setAtIntervalOn(e.target.checked);
                      touchDirty();
                    }}
                  />
                  <span>间隔</span>
                </label>
                <input
                  className="ev-num"
                  value={atIntervalValue}
                  disabled={!atActive || !atIntervalOn}
                  onChange={(e) => {
                    setAtIntervalValue(e.target.value);
                    touchDirty();
                  }}
                />
                <select
                  disabled={!atActive || !atIntervalOn}
                  value={atIntervalUnit}
                  onChange={(e) => {
                    setAtIntervalUnit(e.target.value as EventIntervalUnit);
                    touchDirty();
                  }}
                >
                  {EVENT_INTERVAL_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>

              <div className={`ev-sched-row ${everyActive ? "" : "is-dim"}`}>
                <label className="ev-radio">
                  <input
                    type="radio"
                    name="ev-sched"
                    checked={everyActive}
                    onChange={() => {
                      setScheduleKind("EVERY");
                      touchDirty();
                    }}
                  />
                  <span>EVERY</span>
                </label>
                <input
                  className="ev-num"
                  value={everyValue}
                  disabled={!everyActive}
                  onChange={(e) => {
                    setEveryValue(e.target.value);
                    touchDirty();
                  }}
                />
                <select
                  disabled={!everyActive}
                  value={everyUnit}
                  onChange={(e) => {
                    setEveryUnit(e.target.value as EventIntervalUnit);
                    touchDirty();
                  }}
                >
                  {EVENT_INTERVAL_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>

              <div className={`ev-sched-indent ${everyActive ? "" : "is-dim"}`}>
                <label className="ev-check">
                  <input
                    type="checkbox"
                    checked={startsOn}
                    disabled={!everyActive}
                    onChange={(e) => {
                      setStartsOn(e.target.checked);
                      touchDirty();
                    }}
                  />
                  <span>开始</span>
                </label>
                <input
                  className="ev-sched-main"
                  value={starts}
                  disabled={!everyActive || !startsOn}
                  onChange={(e) => {
                    setStarts(e.target.value);
                    touchDirty();
                  }}
                />
              </div>
              <div
                className={`ev-sched-indent2 ${everyActive && startsOn ? "" : "is-dim"}`}
              >
                <label className="ev-check">
                  <input
                    type="checkbox"
                    checked={startsIntervalOn}
                    disabled={!everyActive || !startsOn}
                    onChange={(e) => {
                      setStartsIntervalOn(e.target.checked);
                      touchDirty();
                    }}
                  />
                  <span>间隔</span>
                </label>
                <input
                  className="ev-num"
                  value={startsIntervalValue}
                  disabled={!everyActive || !startsOn || !startsIntervalOn}
                  onChange={(e) => {
                    setStartsIntervalValue(e.target.value);
                    touchDirty();
                  }}
                />
                <select
                  disabled={!everyActive || !startsOn || !startsIntervalOn}
                  value={startsIntervalUnit}
                  onChange={(e) => {
                    setStartsIntervalUnit(
                      e.target.value as EventIntervalUnit,
                    );
                    touchDirty();
                  }}
                >
                  {EVENT_INTERVAL_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>

              <div className={`ev-sched-indent ${everyActive ? "" : "is-dim"}`}>
                <label className="ev-check">
                  <input
                    type="checkbox"
                    checked={endsOn}
                    disabled={!everyActive}
                    onChange={(e) => {
                      setEndsOn(e.target.checked);
                      touchDirty();
                    }}
                  />
                  <span>结尾</span>
                </label>
                <input
                  className="ev-sched-main"
                  value={ends}
                  disabled={!everyActive || !endsOn}
                  onChange={(e) => {
                    setEnds(e.target.value);
                    touchDirty();
                  }}
                />
              </div>
              <div
                className={`ev-sched-indent2 ${everyActive && endsOn ? "" : "is-dim"}`}
              >
                <label className="ev-check">
                  <input
                    type="checkbox"
                    checked={endsIntervalOn}
                    disabled={!everyActive || !endsOn}
                    onChange={(e) => {
                      setEndsIntervalOn(e.target.checked);
                      touchDirty();
                    }}
                  />
                  <span>间隔</span>
                </label>
                <input
                  className="ev-num"
                  value={endsIntervalValue}
                  disabled={!everyActive || !endsOn || !endsIntervalOn}
                  onChange={(e) => {
                    setEndsIntervalValue(e.target.value);
                    touchDirty();
                  }}
                />
                <select
                  disabled={!everyActive || !endsOn || !endsIntervalOn}
                  value={endsIntervalUnit}
                  onChange={(e) => {
                    setEndsIntervalUnit(e.target.value as EventIntervalUnit);
                    touchDirty();
                  }}
                >
                  {EVENT_INTERVAL_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {pane === "comment" && (
            <div className="ev-pane-comment">
              <textarea
                value={comment}
                placeholder="事件注释…"
                onChange={(e) => {
                  setComment(e.target.value);
                  touchDirty();
                }}
              />
            </div>
          )}

          {pane === "preview" && (
            <div className="ev-pane-preview">
              <div className="ev-preview-toggle">
                <button
                  type="button"
                  className={previewMode === "change" ? "is-active" : ""}
                  onClick={() => setPreviewMode("change")}
                >
                  更改
                </button>
                <button
                  type="button"
                  className={previewMode === "ddl" ? "is-active" : ""}
                  onClick={() => setPreviewMode("ddl")}
                >
                  DDL
                </button>
              </div>
              <pre className="ev-preview-sql">{previewSql}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

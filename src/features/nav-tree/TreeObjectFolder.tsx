import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionDto } from "../connections/types";
import {
  listTables,
  openConnection,
  type DbObject,
} from "../connections/sessionApi";
import {
  loadDesignerColumns,
  loadDesignerForeignKeys,
  loadDesignerIndexes,
  loadDesignerTriggers,
} from "../table-designer/loadColumns";
import { TABLE_DATA_CHANGED } from "../../lib/tableEvents";
import { listEvents } from "../object-list/eventMeta";
import { listRoutines } from "../object-list/routineMeta";
import {
  IconEvents,
  IconFunctions,
  IconTables,
  IconViews,
} from "./TreeIcons";

export type TreeObjectFolderId =
  | "tables"
  | "views"
  | "functions"
  | "events";

type TableDetail = {
  loading: boolean;
  columns: { name: string; type: string }[];
  indexes: string[];
  fks: string[];
  triggers: string[];
};

type Props = {
  conn: ConnectionDto;
  database: string;
  folder: TreeObjectFolderId;
  folderActive: boolean;
  selectedTable: string | null;
  onSelectFolder: () => void;
  onOpenTable: (table: string, kind: string) => void;
  onDesignTable: (table: string, kind?: string) => void;
  onTableContextMenu: (args: {
    x: number;
    y: number;
    table: string;
    kind: string;
  }) => void;
  onFolderContextMenu?: (args: { x: number; y: number }) => void;
  onMessage: (msg: string) => void;
};

const PARTS = [
  { id: "columns", label: "列" },
  { id: "indexes", label: "索引" },
  { id: "fks", label: "外键" },
  { id: "triggers", label: "触发器" },
] as const;

type PartId = (typeof PARTS)[number]["id"];

function folderIcon(folder: TreeObjectFolderId) {
  if (folder === "functions") return <IconFunctions />;
  if (folder === "events") return <IconEvents />;
  return folder === "tables" ? <IconTables /> : <IconViews />;
}

function itemKindBadge(folder: TreeObjectFolderId, kind: string) {
  if (folder === "events") return "Ev";
  if (folder === "functions") {
    return kind === "FUNCTION" || kind === "function" ? "fx" : "Px";
  }
  if (folder === "views" || kind === "view") return "V";
  return "T";
}

export function TreeObjectFolder({
  conn,
  database,
  folder,
  folderActive,
  selectedTable,
  onSelectFolder,
  onOpenTable,
  onDesignTable,
  onTableContextMenu,
  onFolderContextMenu,
  onMessage,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<DbObject[]>([]);
  const [openTables, setOpenTables] = useState<Record<string, boolean>>({});
  const [openParts, setOpenParts] = useState<Record<string, boolean>>({});
  const [details, setDetails] = useState<Record<string, TableDetail>>({});
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      await openConnection(conn.id);
      if (folder === "functions") {
        const routines = await listRoutines({
          connectionId: conn.id,
          engine: String(conn.engine),
          database,
        });
        setItems(
          routines.map((r) => ({
            name: r.name,
            kind: r.routineType,
          })),
        );
      } else if (folder === "events") {
        const events = await listEvents({
          connectionId: conn.id,
          engine: String(conn.engine),
          database,
        });
        setItems(
          events.map((ev) => ({
            name: ev.name,
            kind: "event",
          })),
        );
      } else {
        const all = await listTables(conn.id, database);
        const next =
          folder === "tables"
            ? all.filter((t) => t.kind !== "view")
            : all.filter((t) => t.kind === "view");
        next.sort((a, b) => a.name.localeCompare(b.name, "zh"));
        setItems(next);
      }
    } catch (err) {
      onMessageRef.current(
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setLoading(false);
    }
  }, [conn.id, conn.engine, database, folder]);

  useEffect(() => {
    if (!expanded) return;
    void loadItems();
  }, [expanded, loadItems]);

  useEffect(() => {
    function onChanged(ev: Event) {
      const detail = (ev as CustomEvent).detail as {
        connectionId?: string;
        database?: string;
      };
      if (
        detail?.connectionId === conn.id &&
        detail?.database === database &&
        expanded
      ) {
        void loadItems();
      }
    }
    window.addEventListener(TABLE_DATA_CHANGED, onChanged);
    return () => window.removeEventListener(TABLE_DATA_CHANGED, onChanged);
  }, [conn.id, database, expanded, loadItems]);

  async function ensureDetail(table: string) {
    if (details[table] && !details[table]?.loading) return;
    setDetails((prev) => ({
      ...prev,
      [table]: {
        loading: true,
        columns: prev[table]?.columns ?? [],
        indexes: prev[table]?.indexes ?? [],
        fks: prev[table]?.fks ?? [],
        triggers: prev[table]?.triggers ?? [],
      },
    }));
    try {
      const engine = String(conn.engine);
      const [cols, ixs, fks, trs] = await Promise.all([
        loadDesignerColumns({
          connectionId: conn.id,
          engine,
          database,
          table,
        }),
        loadDesignerIndexes({
          connectionId: conn.id,
          engine,
          database,
          table,
        }),
        loadDesignerForeignKeys({
          connectionId: conn.id,
          engine,
          database,
          table,
        }),
        loadDesignerTriggers({
          connectionId: conn.id,
          engine,
          database,
          table,
        }),
      ]);
      setDetails((prev) => ({
        ...prev,
        [table]: {
          loading: false,
          columns: cols.map((c) => ({
            name: c.name,
            type: c.typeName || "",
          })),
          indexes: ixs.map((x) => x.name),
          fks: fks.map((x) => x.name),
          triggers: trs.map((x) => x.name),
        },
      }));
    } catch (err) {
      setDetails((prev) => ({
        ...prev,
        [table]: {
          loading: false,
          columns: [],
          indexes: [],
          fks: [],
          triggers: [],
        },
      }));
      onMessageRef.current(
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  function toggleTable(name: string) {
    const next = !openTables[name];
    setOpenTables((prev) => ({ ...prev, [name]: next }));
    if (next) void ensureDetail(name);
  }

  function togglePart(table: string, part: PartId) {
    const key = `${table}::${part}`;
    const next = !openParts[key];
    setOpenParts((prev) => ({ ...prev, [key]: next }));
    if (next) void ensureDetail(table);
  }

  function partItems(table: string, part: PartId): string[] {
    const d = details[table];
    if (!d) return [];
    if (part === "columns") return d.columns.map((c) => `${c.name} : ${c.type}`);
    if (part === "indexes") return d.indexes;
    if (part === "fks") return d.fks;
    return d.triggers;
  }

  const label =
    folder === "events"
      ? "事件"
      : folder === "functions"
        ? "函数"
        : folder === "tables"
          ? "表"
          : "视图";
  const isLeafObjectFolder =
    folder === "functions" || folder === "events";

  return (
    <li>
      <div
        className="tree-row tree-db"
        onContextMenu={
          onFolderContextMenu
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                onFolderContextMenu({ x: e.clientX, y: e.clientY });
              }
            : undefined
        }
      >
        <button
          type="button"
          className={`tree-twist ${expanded ? "is-expanded" : ""}`}
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            if (next) onSelectFolder();
          }}
          aria-label={expanded ? `折叠${label}` : `展开${label}`}
        />
        <button
          type="button"
          className={`tree-label tree-folder ${folderActive ? "is-active" : ""}`}
          onClick={() => {
            onSelectFolder();
            if (!expanded) setExpanded(true);
          }}
        >
          {folderIcon(folder)}
          <span className="tree-text">
            {label}
            {expanded && items.length > 0 ? ` (${items.length})` : ""}
          </span>
        </button>
      </div>

      {expanded && (
        <ul className="tree-children tree-object-list">
          {loading && items.length === 0 && (
            <li className="pane-placeholder tree-query-empty">加载中…</li>
          )}
          {!loading && items.length === 0 && (
            <li className="pane-placeholder tree-query-empty">
              暂无{label}
            </li>
          )}
          {items.map((obj) => {
            const tableOpen = !!openTables[obj.name];
            const active = selectedTable === obj.name;
            const detail = details[obj.name];
            return (
              <li key={`${obj.kind}-${obj.name}`}>
                <div className={`tree-row ${active ? "is-active" : ""}`}>
                  {isLeafObjectFolder ? (
                    <span className="tree-twist-spacer" />
                  ) : (
                    <button
                      type="button"
                      className={`tree-twist ${tableOpen ? "is-expanded" : ""}`}
                      onClick={() => toggleTable(obj.name)}
                      aria-label={tableOpen ? "折叠" : "展开"}
                    />
                  )}
                  <button
                    type="button"
                    className="tree-label"
                    title={obj.name}
                    onClick={() => onOpenTable(obj.name, obj.kind)}
                    onDoubleClick={() => onDesignTable(obj.name, obj.kind)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onTableContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        table: obj.name,
                        kind: obj.kind,
                      });
                    }}
                  >
                    <span
                      className={`object-kind tree-obj-badge ${
                        folder === "events"
                          ? "is-event"
                          : obj.kind === "FUNCTION" || obj.kind === "function"
                            ? "is-function"
                            : obj.kind === "PROCEDURE" ||
                                obj.kind === "procedure"
                              ? "is-procedure"
                              : folder === "views"
                                ? "is-view"
                                : ""
                      }`}
                    >
                      {itemKindBadge(folder, obj.kind)}
                    </span>
                    <span className="tree-text">{obj.name}</span>
                  </button>
                </div>

                {!isLeafObjectFolder && tableOpen && (
                  <ul className="tree-children tree-object-meta">
                    {detail?.loading && (
                      <li className="pane-placeholder tree-query-empty">
                        加载结构…
                      </li>
                    )}
                    {PARTS.map((part) => {
                      const partKey = `${obj.name}::${part.id}`;
                      const partOpen = !!openParts[partKey];
                      const children = partItems(obj.name, part.id);
                      return (
                        <li key={part.id}>
                          <div className="tree-row">
                            <button
                              type="button"
                              className={`tree-twist ${partOpen ? "is-expanded" : ""}`}
                              onClick={() => togglePart(obj.name, part.id)}
                              aria-label={partOpen ? "折叠" : "展开"}
                            />
                            <button
                              type="button"
                              className="tree-label tree-folder"
                              onClick={() => togglePart(obj.name, part.id)}
                            >
                              <span className="tree-text">
                                {part.label}
                                {children.length > 0
                                  ? ` (${children.length})`
                                  : ""}
                              </span>
                            </button>
                          </div>
                          {partOpen && (
                            <ul className="tree-children tree-object-leaf">
                              {children.length === 0 ? (
                                <li className="pane-placeholder tree-query-empty">
                                  无
                                </li>
                              ) : (
                                children.map((text) => (
                                  <li key={text}>
                                    <div className="tree-row">
                                      <span className="tree-twist-spacer" />
                                      <span
                                        className="tree-label tree-meta-leaf"
                                        title={text}
                                      >
                                        <span className="tree-text">{text}</span>
                                      </span>
                                    </div>
                                  </li>
                                ))
                              )}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

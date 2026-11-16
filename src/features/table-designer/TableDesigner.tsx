import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  executeSql,
  openConnection,
} from "../connections/sessionApi";
import type { DesignerTab } from "../../stores/workspaceStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { engineKey, identOk, quoteIdent, quoteTable } from "../nav-tree/sqlIdent";
import {
  buildAlterTableSql,
  buildCreateTableSql,
  buildTriggerSql,
} from "./ddl";
import {
  loadDesignerChecks,
  loadDesignerColumns,
  loadDesignerForeignKeys,
  loadDesignerIndexes,
  loadDesignerTriggers,
  loadMysqlCharsets,
  loadTableOptions,
} from "./loadColumns";
import {
  MYSQL_CHARSETS,
  MYSQL_COLLATIONS_BY_CHARSET,
  collationsForCharset,
  defaultCollationForCharset,
  typeSupportsDecimals,
  typeSupportsLength,
} from "./mysqlCharsets";
import {
  MYSQL_TYPES,
  composedType,
  emptyOptions,
  newColumn,
  parseRawType,
  type DesignerCheck,
  type DesignerColumn,
  type DesignerForeignKey,
  type DesignerIndex,
  type DesignerTrigger,
  type TableInfoStats,
  type TableOptions,
} from "./types";

type DesignerPane =
  | "fields"
  | "indexes"
  | "fks"
  | "triggers"
  | "checks"
  | "options"
  | "comments"
  | "sql";

type Props = { tab: DesignerTab };

const PANES: { id: DesignerPane; label: string }[] = [
  { id: "fields", label: "字段" },
  { id: "indexes", label: "索引" },
  { id: "fks", label: "外键" },
  { id: "triggers", label: "触发器" },
  { id: "checks", label: "检查" },
  { id: "options", label: "选项" },
  { id: "comments", label: "注释" },
  { id: "sql", label: "SQL 预览" },
];

function seedToColumn(s: {
  name: string;
  rawType: string;
  nullable: boolean;
  isPk: boolean;
}): DesignerColumn {
  const parsed = parseRawType(s.rawType);
  return newColumn({
    name: s.name,
    typeName: parsed.typeName,
    length: parsed.length,
    decimals: parsed.decimals,
    notNull: !s.nullable,
    isPk: s.isPk,
    originalName: null,
  });
}

export function TableDesigner({ tab }: Props) {
  const markDirty = useWorkspaceStore((s) => s.markDesignerDirty);
  const updateTab = useWorkspaceStore((s) => s.updateDesignerTab);
  const openTable = useWorkspaceStore((s) => s.openTable);

  const [pane, setPane] = useState<DesignerPane>("fields");
  const [tableName, setTableName] = useState(tab.table);
  const [columns, setColumns] = useState<DesignerColumn[]>([]);
  const [baseline, setBaseline] = useState<DesignerColumn[]>([]);
  const [indexes, setIndexes] = useState<DesignerIndex[]>([]);
  const [fks, setFks] = useState<DesignerForeignKey[]>([]);
  const [triggers, setTriggers] = useState<DesignerTrigger[]>([]);
  const [checks, setChecks] = useState<DesignerCheck[]>([]);
  const [options, setOptions] = useState<TableOptions>(emptyOptions());
  const [baselineOptions, setBaselineOptions] = useState<TableOptions>(
    emptyOptions(),
  );
  const [stats, setStats] = useState<TableInfoStats>({
    tableRows: "—",
    dataLength: "—",
    indexLength: "—",
    createTime: "—",
    updateTime: "—",
  });
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [charsetList, setCharsetList] = useState<string[]>([...MYSQL_CHARSETS]);
  const [collationMap, setCollationMap] = useState<Record<string, string[]>>(
    MYSQL_COLLATIONS_BY_CHARSET,
  );

  // Keep latest tab fields without re-binding load to the whole tab object
  // (markDirty updates store → new tab ref → would otherwise reset edits).
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const touch = useCallback(() => {
    setDirty(true);
    markDirty(tabRef.current.id, true);
    setMessage(null);
  }, [markDirty]);

  const collationChoices = useMemo(() => {
    const fromServer = collationMap[options.charset];
    if (fromServer?.length) return fromServer;
    return collationsForCharset(options.charset);
  }, [collationMap, options.charset]);

  const load = useCallback(async () => {
    const t = tabRef.current;
    if (t.mode === "create") {
      const seed = t.seedColumns?.length
        ? t.seedColumns.map(seedToColumn)
        : [
            newColumn({
              name: "id",
              typeName: "bigint",
              length: "",
              notNull: true,
              isPk: true,
              extra: "auto_increment",
            }),
            newColumn({ name: "name", typeName: "varchar", length: "255" }),
          ];
      setColumns(seed);
      setBaseline([]);
      setIndexes([]);
      setFks([]);
      setTriggers([]);
      setChecks([]);
      setOptions(emptyOptions());
      setBaselineOptions(emptyOptions());
      setTableName(t.table || "new_table");
      setSelectedIdx(0);
      setDirty(true);
      markDirty(t.id, true);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const cols = await loadDesignerColumns({
        connectionId: t.connectionId,
        engine: t.connectionEngine,
        database: t.database,
        table: t.table,
      });
      setColumns(cols);
      setBaseline(cols.map((c) => ({ ...c })));
      setTableName(t.table);
      setSelectedIdx(0);

      const [ix, fk, tr, ck, meta, cs] = await Promise.all([
        loadDesignerIndexes({
          connectionId: t.connectionId,
          engine: t.connectionEngine,
          database: t.database,
          table: t.table,
        }),
        loadDesignerForeignKeys({
          connectionId: t.connectionId,
          engine: t.connectionEngine,
          database: t.database,
          table: t.table,
        }),
        loadDesignerTriggers({
          connectionId: t.connectionId,
          engine: t.connectionEngine,
          database: t.database,
          table: t.table,
        }),
        loadDesignerChecks({
          connectionId: t.connectionId,
          engine: t.connectionEngine,
          database: t.database,
          table: t.table,
        }),
        loadTableOptions({
          connectionId: t.connectionId,
          engine: t.connectionEngine,
          database: t.database,
          table: t.table,
        }),
        engineKey(t.connectionEngine) === "mysql"
          ? loadMysqlCharsets({ connectionId: t.connectionId })
          : Promise.resolve({ charsets: [], collationsByCharset: {} }),
      ]);
      setIndexes(ix);
      setFks(fk);
      setTriggers(tr);
      setChecks(ck);
      setOptions(meta.options);
      setBaselineOptions({ ...meta.options });
      setStats(meta.stats);
      if (cs.charsets.length) {
        setCharsetList(cs.charsets);
      }
      if (Object.keys(cs.collationsByCharset).length) {
        setCollationMap(cs.collationsByCharset);
      }
      setDirty(false);
      markDirty(t.id, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [markDirty]);

  // Only reload when switching designer tab identity — never on dirty flag updates.
  useEffect(() => {
    void load();
  }, [tab.id, load]);

  useEffect(() => {
    if (engineKey(tab.connectionEngine) !== "mysql") return;
    void loadMysqlCharsets({ connectionId: tab.connectionId })
      .then((cs) => {
        if (cs.charsets.length) setCharsetList(cs.charsets);
        if (Object.keys(cs.collationsByCharset).length) {
          setCollationMap(cs.collationsByCharset);
        }
      })
      .catch(() => {
        /* keep defaults */
      });
  }, [tab.id, tab.connectionId, tab.connectionEngine]);

  function patchCol(key: string, patch: Partial<DesignerColumn>) {
    setColumns((prev) =>
      prev.map((c) => (c.key === key ? { ...c, ...patch } : c)),
    );
    touch();
  }

  function addCol(afterIndex?: number) {
    const col = newColumn();
    setColumns((prev) => {
      if (afterIndex == null || afterIndex < 0 || afterIndex >= prev.length) {
        return [...prev, col];
      }
      const next = [...prev];
      next.splice(afterIndex + 1, 0, col);
      return next;
    });
    touch();
  }

  function removeSelected() {
    if (columns.length === 0) return;
    const key = columns[selectedIdx]?.key;
    if (!key) return;
    setColumns((prev) => prev.filter((c) => c.key !== key));
    setSelectedIdx((i) => Math.max(0, Math.min(i, columns.length - 2)));
    touch();
  }

  function moveSelected(dir: -1 | 1) {
    setColumns((prev) => {
      const i = selectedIdx;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[i]!;
      next[i] = next[j]!;
      next[j] = tmp;
      return next;
    });
    setSelectedIdx((i) => {
      const j = i + dir;
      if (j < 0 || j >= columns.length) return i;
      return j;
    });
    touch();
  }

  const previewSql = useMemo(() => {
    try {
      if (tab.mode === "create") {
        return (
          buildCreateTableSql({
            engine: tab.connectionEngine,
            database: tab.database,
            table: tableName.trim() || "new_table",
            columns,
            indexes,
            foreignKeys: fks,
            checks,
            options,
          }) + ";"
        );
      }
      const stmts = buildAlterTableSql({
        engine: tab.connectionEngine,
        database: tab.database,
        table: tab.table,
        baseline,
        columns,
        options,
        baselineOptions,
      });
      return stmts.length ? stmts.join(";\n") + ";" : "-- 无字段/选项变更";
    } catch (err) {
      return `-- ${err instanceof Error ? err.message : String(err)}`;
    }
  }, [
    tab,
    tableName,
    columns,
    indexes,
    fks,
    checks,
    options,
    baseline,
    baselineOptions,
  ]);

  async function onSave() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await openConnection(tab.connectionId);
      if (tab.mode === "create") {
        const name = tableName.trim();
        if (!identOk(name)) throw new Error("表名仅允许字母、数字、下划线");
        const sql = buildCreateTableSql({
          engine: tab.connectionEngine,
          database: tab.database,
          table: name,
          columns,
          indexes: indexes.filter((i) => i.name.toUpperCase() !== "PRIMARY"),
          foreignKeys: fks,
          checks,
          options,
        });
        await executeSql(tab.connectionId, sql);
        for (const tr of triggers) {
          if (!tr.name.trim() || !tr.statement.trim()) continue;
          await executeSql(
            tab.connectionId,
            buildTriggerSql({
              engine: tab.connectionEngine,
              database: tab.database,
              table: name,
              trigger: tr,
            }),
          );
        }
        updateTab(tab.id, { table: name, dirty: false });
        markDirty(tab.id, false);
        setDirty(false);
        setMessage(`已创建表 ${name}`);
        openTable(name);
        return;
      }

      const stmts = buildAlterTableSql({
        engine: tab.connectionEngine,
        database: tab.database,
        table: tab.table,
        baseline,
        columns,
        options,
        baselineOptions,
      });
      for (const sql of stmts) {
        await executeSql(tab.connectionId, sql);
      }

      // index sync (mysql): drop removed, add new
      if (engineKey(tab.connectionEngine) === "mysql") {
        const qt = quoteTable(tab.connectionEngine, tab.database, tab.table);
        const baseIx = await loadDesignerIndexes({
          connectionId: tab.connectionId,
          engine: tab.connectionEngine,
          database: tab.database,
          table: tab.table,
        });
        const want = indexes.filter((i) => i.name.toUpperCase() !== "PRIMARY");
        const wantNames = new Set(want.map((i) => i.name));
        for (const b of baseIx) {
          if (b.name.toUpperCase() === "PRIMARY") continue;
          if (!wantNames.has(b.name)) {
            await executeSql(
              tab.connectionId,
              `DROP INDEX ${quoteIdent("mysql", b.name)} ON ${qt}`,
            );
          }
        }
        const have = new Set(
          baseIx.map((i) => i.name).filter((n) => n.toUpperCase() !== "PRIMARY"),
        );
        for (const ix of want) {
          if (!ix.originalName || !have.has(ix.name)) {
            if (!identOk(ix.name)) continue;
            const cols = ix.columns
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .map((c) => quoteIdent("mysql", c))
              .join(", ");
            if (!cols) continue;
            const uniq = ix.unique ? "UNIQUE " : "";
            await executeSql(
              tab.connectionId,
              `CREATE ${uniq}INDEX ${quoteIdent("mysql", ix.name)} ON ${qt} (${cols})`,
            );
          }
        }

        // FK: drop removed / add new (simple)
        const baseFk = await loadDesignerForeignKeys({
          connectionId: tab.connectionId,
          engine: tab.connectionEngine,
          database: tab.database,
          table: tab.table,
        });
        const wantFk = new Set(fks.map((f) => f.name));
        for (const b of baseFk) {
          if (!wantFk.has(b.name)) {
            await executeSql(
              tab.connectionId,
              `ALTER TABLE ${qt} DROP FOREIGN KEY ${quoteIdent("mysql", b.name)}`,
            );
          }
        }
        const haveFk = new Set(baseFk.map((f) => f.name));
        for (const fk of fks) {
          if (fk.originalName && haveFk.has(fk.name)) continue;
          if (!identOk(fk.name) || !fk.refTable.trim()) continue;
          const cols = fk.columns
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((c) => quoteIdent("mysql", c))
            .join(", ");
          const refs = fk.refColumns
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((c) => quoteIdent("mysql", c))
            .join(", ");
          if (!cols || !refs) continue;
          await executeSql(
            tab.connectionId,
            `ALTER TABLE ${qt} ADD CONSTRAINT ${quoteIdent("mysql", fk.name)} FOREIGN KEY (${cols}) REFERENCES ${quoteIdent("mysql", fk.refTable)} (${refs}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`,
          );
        }

        // checks
        const baseCk = await loadDesignerChecks({
          connectionId: tab.connectionId,
          engine: tab.connectionEngine,
          database: tab.database,
          table: tab.table,
        });
        const wantCk = new Set(checks.map((c) => c.name));
        for (const b of baseCk) {
          if (!wantCk.has(b.name)) {
            await executeSql(
              tab.connectionId,
              `ALTER TABLE ${qt} DROP CHECK ${quoteIdent("mysql", b.name)}`,
            );
          }
        }
        const haveCk = new Set(baseCk.map((c) => c.name));
        for (const ck of checks) {
          if (ck.originalName && haveCk.has(ck.name)) continue;
          if (!identOk(ck.name) || !ck.expression.trim()) continue;
          await executeSql(
            tab.connectionId,
            `ALTER TABLE ${qt} ADD CONSTRAINT ${quoteIdent("mysql", ck.name)} CHECK (${ck.expression})`,
          );
        }

        // triggers: drop+recreate changed/new
        const baseTr = await loadDesignerTriggers({
          connectionId: tab.connectionId,
          engine: tab.connectionEngine,
          database: tab.database,
          table: tab.table,
        });
        const wantTr = new Set(triggers.map((t) => t.name));
        for (const b of baseTr) {
          if (!wantTr.has(b.name)) {
            await executeSql(
              tab.connectionId,
              `DROP TRIGGER IF EXISTS ${quoteIdent("mysql", b.name)}`,
            );
          }
        }
        for (const tr of triggers) {
          if (!tr.name.trim() || !tr.statement.trim()) continue;
          const old = baseTr.find((t) => t.name === tr.name);
          if (
            old &&
            old.timing === tr.timing &&
            old.event === tr.event &&
            old.statement === tr.statement
          ) {
            continue;
          }
          if (old) {
            await executeSql(
              tab.connectionId,
              `DROP TRIGGER IF EXISTS ${quoteIdent("mysql", tr.name)}`,
            );
          }
          await executeSql(
            tab.connectionId,
            buildTriggerSql({
              engine: tab.connectionEngine,
              database: tab.database,
              table: tab.table,
              trigger: tr,
            }),
          );
        }
      }

      markDirty(tab.id, false);
      setDirty(false);
      setMessage("已保存设计更改");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function onDiscard() {
    if (!dirty) return;
    if (!window.confirm("放弃未保存的设计更改？")) return;
    void load();
    setMessage("已放弃更改");
  }

  const isMysql = engineKey(tab.connectionEngine) === "mysql";
  const canSave =
    !saving &&
    !loading &&
    columns.length > 0 &&
    (tab.mode === "create" || dirty);

  return (
    <div className="table-designer navicat-designer">
      <div className="td-topbar">
        <div className="td-tools">
          {pane === "fields" && (
            <>
              <button type="button" title="添加字段" disabled={saving} onClick={() => addCol()}>
                ＋
              </button>
              <button
                type="button"
                title="在下方插入"
                disabled={saving}
                onClick={() => addCol(selectedIdx)}
              >
                插入
              </button>
              <button type="button" title="删除字段" disabled={saving} onClick={removeSelected}>
                －
              </button>
              <span className="td-tool-sep" />
              <button type="button" title="上移" disabled={saving} onClick={() => moveSelected(-1)}>
                ↑
              </button>
              <button type="button" title="下移" disabled={saving} onClick={() => moveSelected(1)}>
                ↓
              </button>
            </>
          )}
          <div className="td-topbar-spacer" />
          {tab.mode === "create" && (
            <label className="td-table-name">
              表名
              <input
                value={tableName}
                disabled={saving}
                onChange={(e) => {
                  const v = e.target.value;
                  setTableName(v);
                  touch();
                  updateTab(tab.id, {
                    table: v.trim() || "new_table",
                  });
                }}
              />
            </label>
          )}
          <span className={`td-dirty-flag ${dirty ? "is-dirty" : ""}`}>
            {dirty ? "未保存" : "已保存"}
          </span>
          <button
            type="button"
            disabled={saving || loading || !dirty}
            onClick={onDiscard}
            title="放弃更改"
          >
            放弃
          </button>
          <button
            type="button"
            className="td-save-btn"
            disabled={!canSave}
            onClick={() => void onSave()}
          >
            {saving ? "保存中…" : dirty || tab.mode === "create" ? "保存" : "已保存"}
          </button>
        </div>
        <div className="td-tabs" role="tablist">
          {PANES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              className={pane === p.id ? "is-active" : ""}
              aria-selected={pane === p.id}
              onClick={() => setPane(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="pane-error td-banner">{error}</p>}
      {message && <p className="pane-placeholder td-banner">{message}</p>}
      {loading && <p className="pane-placeholder td-banner">加载中…</p>}

      <div className="td-body">
        <div className="td-main">
          {!loading && pane === "fields" && (
            <div className="td-grid-wrap">
              <table className="td-grid">
                <thead>
                  <tr>
                    <th className="td-col-name">名称</th>
                    <th className="td-col-type">类型</th>
                    <th className="td-col-len">长度</th>
                    <th>小数点</th>
                    <th>不是 Null</th>
                    <th>虚拟</th>
                    <th>键</th>
                    <th>默认值</th>
                    <th>注释</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map((c, i) => (
                    <tr
                      key={c.key}
                      className={i === selectedIdx ? "is-selected" : undefined}
                      onClick={() => setSelectedIdx(i)}
                    >
                      <td className="td-col-name">
                        <input
                          value={c.name}
                          onChange={(e) => patchCol(c.key, { name: e.target.value })}
                        />
                      </td>
                      <td className="td-col-type">
                        <select
                          value={c.typeName}
                          onChange={(e) => {
                            const typeName = e.target.value;
                            const patch: Partial<DesignerColumn> = { typeName };
                            if (!typeSupportsLength(typeName)) {
                              patch.length = "";
                              patch.decimals = "";
                            } else if (
                              typeName === "varchar" &&
                              !c.length.trim()
                            ) {
                              patch.length = "255";
                            }
                            if (!typeSupportsDecimals(typeName)) {
                              patch.decimals = "";
                            }
                            patchCol(c.key, patch);
                          }}
                        >
                          {!MYSQL_TYPES.includes(c.typeName) && (
                            <option value={c.typeName}>{c.typeName}</option>
                          )}
                          {MYSQL_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          value={c.length}
                          disabled={!typeSupportsLength(c.typeName)}
                          onChange={(e) =>
                            patchCol(c.key, { length: e.target.value })
                          }
                        />
                      </td>
                      <td>
                        <input
                          value={c.decimals}
                          disabled={!typeSupportsDecimals(c.typeName)}
                          onChange={(e) =>
                            patchCol(c.key, { decimals: e.target.value })
                          }
                        />
                      </td>
                      <td className="td-check">
                        <input
                          type="checkbox"
                          checked={c.notNull}
                          onChange={(e) =>
                            patchCol(c.key, { notNull: e.target.checked })
                          }
                        />
                      </td>
                      <td className="td-check">
                        <input
                          type="checkbox"
                          checked={c.virtual}
                          onChange={(e) =>
                            patchCol(c.key, { virtual: e.target.checked })
                          }
                        />
                      </td>
                      <td className="td-check td-key">
                        <button
                          type="button"
                          className={c.isPk ? "is-pk" : ""}
                          title="主键"
                          onClick={(e) => {
                            e.stopPropagation();
                            patchCol(c.key, { isPk: !c.isPk, notNull: true });
                          }}
                        >
                          {c.isPk ? "🔑" : "·"}
                        </button>
                      </td>
                      <td>
                        <input
                          value={c.defaultValue ?? ""}
                          placeholder="NULL"
                          onChange={(e) =>
                            patchCol(c.key, {
                              defaultValue:
                                e.target.value.trim() === ""
                                  ? null
                                  : e.target.value,
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          value={c.comment}
                          onChange={(e) =>
                            patchCol(c.key, { comment: e.target.value })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && pane === "indexes" && (
            <ObjectEditor
              title="索引"
              rows={indexes}
              columns={[
                { key: "name", label: "名称" },
                { key: "columns", label: "字段" },
                { key: "indexType", label: "类型" },
              ]}
              onAdd={() => {
                setIndexes((prev) => [
                  ...prev,
                  {
                    key: `ix-${Date.now()}`,
                    name: `idx_${columns[0]?.name || "col"}`,
                    columns: columns[0]?.name || "",
                    unique: false,
                    indexType: "BTREE",
                    originalName: null,
                  },
                ]);
                touch();
              }}
              onChange={(key, patch) => {
                setIndexes((prev) =>
                  prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
                );
                touch();
              }}
              onRemove={(key) => {
                setIndexes((prev) => prev.filter((r) => r.key !== key));
                touch();
              }}
              extraCell={(r) => (
                <label className="td-inline-check">
                  <input
                    type="checkbox"
                    checked={r.unique}
                    disabled={r.name.toUpperCase() === "PRIMARY"}
                    onChange={(e) => {
                      setIndexes((prev) =>
                        prev.map((x) =>
                          x.key === r.key
                            ? { ...x, unique: e.target.checked }
                            : x,
                        ),
                      );
                      touch();
                    }}
                  />
                  唯一
                </label>
              )}
            />
          )}

          {!loading && pane === "fks" && (
            <ObjectEditor
              title="外键"
              rows={fks}
              columns={[
                { key: "name", label: "名称" },
                { key: "columns", label: "字段" },
                { key: "refTable", label: "引用表" },
                { key: "refColumns", label: "引用字段" },
                { key: "onDelete", label: "ON DELETE" },
                { key: "onUpdate", label: "ON UPDATE" },
              ]}
              onAdd={() => {
                setFks((prev) => [
                  ...prev,
                  {
                    key: `fk-${Date.now()}`,
                    name: `fk_${tableName || tab.table}_${prev.length + 1}`,
                    columns: "",
                    refTable: "",
                    refColumns: "",
                    onDelete: "RESTRICT",
                    onUpdate: "RESTRICT",
                    originalName: null,
                  },
                ]);
                touch();
              }}
              onChange={(key, patch) => {
                setFks((prev) =>
                  prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
                );
                touch();
              }}
              onRemove={(key) => {
                setFks((prev) => prev.filter((r) => r.key !== key));
                touch();
              }}
            />
          )}

          {!loading && pane === "triggers" && (
            <div className="td-triggers">
              <div className="td-section-toolbar">
                <button
                  type="button"
                  onClick={() => {
                    setTriggers((prev) => [
                      ...prev,
                      {
                        key: `tr-${Date.now()}`,
                        name: `trg_${tableName || tab.table}_${prev.length + 1}`,
                        timing: "BEFORE",
                        event: "INSERT",
                        statement: "BEGIN\n  -- body\nEND",
                        originalName: null,
                      },
                    ]);
                    touch();
                  }}
                >
                  添加触发器
                </button>
              </div>
              {triggers.map((tr) => (
                <div key={tr.key} className="td-trigger-card">
                  <div className="td-trigger-head">
                    <input
                      value={tr.name}
                      onChange={(e) => {
                        setTriggers((prev) =>
                          prev.map((t) =>
                            t.key === tr.key
                              ? { ...t, name: e.target.value }
                              : t,
                          ),
                        );
                        touch();
                      }}
                    />
                    <select
                      value={tr.timing}
                      onChange={(e) => {
                        setTriggers((prev) =>
                          prev.map((t) =>
                            t.key === tr.key
                              ? { ...t, timing: e.target.value }
                              : t,
                          ),
                        );
                        touch();
                      }}
                    >
                      <option>BEFORE</option>
                      <option>AFTER</option>
                    </select>
                    <select
                      value={tr.event}
                      onChange={(e) => {
                        setTriggers((prev) =>
                          prev.map((t) =>
                            t.key === tr.key
                              ? { ...t, event: e.target.value }
                              : t,
                          ),
                        );
                        touch();
                      }}
                    >
                      <option>INSERT</option>
                      <option>UPDATE</option>
                      <option>DELETE</option>
                    </select>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => {
                        setTriggers((prev) =>
                          prev.filter((t) => t.key !== tr.key),
                        );
                        touch();
                      }}
                    >
                      删除
                    </button>
                  </div>
                  <textarea
                    rows={5}
                    value={tr.statement}
                    onChange={(e) => {
                      setTriggers((prev) =>
                        prev.map((t) =>
                          t.key === tr.key
                            ? { ...t, statement: e.target.value }
                            : t,
                        ),
                      );
                      touch();
                    }}
                  />
                </div>
              ))}
              {triggers.length === 0 && (
                <p className="pane-placeholder">无触发器</p>
              )}
            </div>
          )}

          {!loading && pane === "checks" && (
            <ObjectEditor
              title="检查约束"
              rows={checks}
              columns={[
                { key: "name", label: "名称" },
                { key: "expression", label: "表达式" },
              ]}
              onAdd={() => {
                setChecks((prev) => [
                  ...prev,
                  {
                    key: `ck-${Date.now()}`,
                    name: `chk_${prev.length + 1}`,
                    expression: "",
                    originalName: null,
                  },
                ]);
                touch();
              }}
              onChange={(key, patch) => {
                setChecks((prev) =>
                  prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
                );
                touch();
              }}
              onRemove={(key) => {
                setChecks((prev) => prev.filter((r) => r.key !== key));
                touch();
              }}
            />
          )}

          {!loading && pane === "options" && (
            <div className="td-options">
              {!isMysql && (
                <p className="pane-placeholder">选项页目前以 MySQL 为主。</p>
              )}
              <label>
                引擎
                <select
                  value={options.engine}
                  onChange={(e) => {
                    setOptions((o) => ({ ...o, engine: e.target.value }));
                    touch();
                  }}
                >
                  {["InnoDB", "MyISAM", "MEMORY", "CSV", "ARCHIVE"]
                    .concat(
                      options.engine &&
                        !["InnoDB", "MyISAM", "MEMORY", "CSV", "ARCHIVE"].includes(
                          options.engine,
                        )
                        ? [options.engine]
                        : [],
                    )
                    .map((eng) => (
                      <option key={eng} value={eng}>
                        {eng}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                字符集
                <select
                  value={options.charset}
                  onChange={(e) => {
                    const charset = e.target.value;
                    const nextColl =
                      collationMap[charset]?.[0] ||
                      defaultCollationForCharset(charset);
                    setOptions((o) => ({
                      ...o,
                      charset,
                      collation: nextColl,
                    }));
                    touch();
                  }}
                >
                  {!charsetList.includes(options.charset) && options.charset && (
                    <option value={options.charset}>{options.charset}</option>
                  )}
                  {charsetList.map((cs) => (
                    <option key={cs} value={cs}>
                      {cs}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                排序规则
                <select
                  value={options.collation}
                  onChange={(e) => {
                    setOptions((o) => ({ ...o, collation: e.target.value }));
                    touch();
                  }}
                >
                  {!collationChoices.includes(options.collation) &&
                    options.collation && (
                      <option value={options.collation}>
                        {options.collation}
                      </option>
                    )}
                  {collationChoices.map((cl) => (
                    <option key={cl} value={cl}>
                      {cl}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                行格式
                <select
                  value={options.rowFormat}
                  onChange={(e) => {
                    setOptions((o) => ({ ...o, rowFormat: e.target.value }));
                    touch();
                  }}
                >
                  {["Dynamic", "Compact", "Redundant", "Compressed"]
                    .concat(
                      options.rowFormat &&
                        ![
                          "Dynamic",
                          "Compact",
                          "Redundant",
                          "Compressed",
                        ].includes(options.rowFormat)
                        ? [options.rowFormat]
                        : [],
                    )
                    .map((rf) => (
                      <option key={rf} value={rf}>
                        {rf}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                自增值
                <input
                  type="number"
                  min={0}
                  value={options.autoIncrement}
                  onChange={(e) => {
                    setOptions((o) => ({
                      ...o,
                      autoIncrement: e.target.value,
                    }));
                    touch();
                  }}
                />
              </label>
            </div>
          )}

          {!loading && pane === "comments" && (
            <div className="td-comments">
              <label>
                表注释
                <textarea
                  rows={8}
                  value={options.comment}
                  onChange={(e) => {
                    setOptions((o) => ({ ...o, comment: e.target.value }));
                    touch();
                  }}
                />
              </label>
            </div>
          )}

          {!loading && pane === "sql" && (
            <div className="td-sql-pane">
              <pre>{previewSql}</pre>
            </div>
          )}
        </div>

        <aside className="td-side">
          <div className="td-side-title">
            {tab.mode === "create" ? tableName || "新表" : tab.table}
          </div>
          <dl className="td-side-dl">
            <div>
              <dt>连接</dt>
              <dd>{tab.connectionName}</dd>
            </div>
            <div>
              <dt>数据库</dt>
              <dd>{tab.database}</dd>
            </div>
            <div>
              <dt>行</dt>
              <dd>{stats.tableRows}</dd>
            </div>
            <div>
              <dt>引擎</dt>
              <dd>{options.engine || "—"}</dd>
            </div>
            <div>
              <dt>自增</dt>
              <dd>{options.autoIncrement || "—"}</dd>
            </div>
            <div>
              <dt>行格式</dt>
              <dd>{options.rowFormat || "—"}</dd>
            </div>
            <div>
              <dt>创建</dt>
              <dd>{stats.createTime}</dd>
            </div>
            <div>
              <dt>索引长度</dt>
              <dd>{stats.indexLength}</dd>
            </div>
            <div>
              <dt>数据长度</dt>
              <dd>{stats.dataLength}</dd>
            </div>
            <div>
              <dt>排序规则</dt>
              <dd>{options.collation || "—"}</dd>
            </div>
            <div>
              <dt>字段数</dt>
              <dd>{columns.length}</dd>
            </div>
            <div>
              <dt>类型预览</dt>
              <dd className="td-side-mono">
                {columns[selectedIdx]
                  ? composedType(columns[selectedIdx]!)
                  : "—"}
              </dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>
  );
}

function ObjectEditor<T extends { key: string }>({
  title,
  rows,
  columns,
  onAdd,
  onChange,
  onRemove,
  extraCell,
}: {
  title: string;
  rows: T[];
  columns: { key: keyof T & string; label: string }[];
  onAdd: () => void;
  onChange: (key: string, patch: Partial<T>) => void;
  onRemove: (key: string) => void;
  extraCell?: (row: T) => ReactNode;
}) {
  return (
    <div className="td-object-editor">
      <div className="td-section-toolbar">
        <span>{title}</span>
        <button type="button" onClick={onAdd}>
          添加
        </button>
      </div>
      <div className="td-grid-wrap">
        <table className="td-grid">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              {extraCell && <th />}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                {columns.map((c) => (
                  <td key={c.key}>
                    <input
                      value={String((r as Record<string, unknown>)[c.key] ?? "")}
                      onChange={(e) =>
                        onChange(r.key, {
                          [c.key]: e.target.value,
                        } as Partial<T>)
                      }
                    />
                  </td>
                ))}
                {extraCell && <td>{extraCell(r)}</td>}
                <td>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => onRemove(r.key)}
                  >
                    删
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + (extraCell ? 2 : 1)}
                  className="pane-placeholder"
                >
                  无数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

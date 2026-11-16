import { useEffect, useState } from "react";
import type { ConnectionDto } from "../connections/types";
import type { RoutineType } from "../object-list/routineMeta";
import {
  loadRoutineParams,
  runRoutine,
} from "../nav-tree/routineMenuActions";
import type { RoutineParam } from "./routineDdl";

type Props = {
  conn: ConnectionDto;
  database: string;
  name: string;
  routineType: RoutineType;
  onClose: () => void;
  onMessage: (msg: string) => void;
};

export function RunRoutineDialog({
  conn,
  database,
  name,
  routineType,
  onClose,
  onMessage,
}: Props) {
  const [params, setParams] = useState<RoutineParam[]>([]);
  const [values, setValues] = useState<string[]>([]);
  const [nullFlags, setNullFlags] = useState<boolean[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    columns: string[];
    rows: unknown[][];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const ps = await loadRoutineParams({
          conn,
          database,
          name,
          routineType,
        });
        if (cancelled) return;
        setParams(ps);
        setValues(ps.map(() => ""));
        setNullFlags(ps.map(() => false));
      } catch (err) {
        if (!cancelled) {
          setParams([]);
          setValues([]);
          setNullFlags([]);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conn, database, name, routineType]);

  async function onRun() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const out = await runRoutine({
        conn,
        database,
        name,
        routineType,
        values,
        nullFlags,
      });
      setResult(out);
      onMessage(
        out.rows.length
          ? `运行完成，返回 ${out.rows.length} 行`
          : "运行完成",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const label = routineType === "FUNCTION" ? "函数" : "过程";

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="modal run-routine-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>
          运行{label} {database}.{name}
        </h2>
        {loading ? (
          <p className="pane-placeholder">加载参数…</p>
        ) : (
          <>
            {params.length === 0 ? (
              <p className="pane-placeholder">无参数，可直接运行。</p>
            ) : (
              <table className="run-routine-params">
                <thead>
                  <tr>
                    <th>参数</th>
                    <th>模式</th>
                    <th>类型</th>
                    <th>值</th>
                    <th>NULL</th>
                  </tr>
                </thead>
                <tbody>
                  {params.map((p, i) => (
                    <tr key={`${p.name}-${i}`}>
                      <td>{p.name}</td>
                      <td>{p.mode}</td>
                      <td>{p.dataType}</td>
                      <td>
                        <input
                          value={values[i] ?? ""}
                          disabled={!!nullFlags[i] || p.mode === "OUT"}
                          onChange={(e) => {
                            const next = [...values];
                            next[i] = e.target.value;
                            setValues(next);
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={!!nullFlags[i]}
                          disabled={p.mode === "OUT"}
                          onChange={(e) => {
                            const next = [...nullFlags];
                            next[i] = e.target.checked;
                            setNullFlags(next);
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {error && <p className="pane-error">{error}</p>}
            {result && (
              <div className="run-routine-result">
                {result.columns.length === 0 ? (
                  <p className="pane-ok">已执行（无结果集）</p>
                ) : (
                  <table className="object-list-table">
                    <thead>
                      <tr>
                        {result.columns.map((c) => (
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, ri) => (
                        <tr key={ri}>
                          {row.map((cell, ci) => (
                            <td key={ci}>
                              {cell == null ? "NULL" : String(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            关闭
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={loading || busy}
            onClick={() => void onRun()}
          >
            {busy ? "运行中…" : "开始"}
          </button>
        </div>
      </div>
    </div>
  );
}

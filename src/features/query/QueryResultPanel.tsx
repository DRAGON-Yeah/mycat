import { useEffect, useMemo, useState } from "react";
import {
  QueryResultGrid,
  type QueryResultData,
} from "./QueryResultGrid";

export type QueryBatchItem = {
  id: string;
  sql: string;
  kind: "result" | "explain" | "message";
  result?: QueryResultData;
  error?: string;
  elapsedMs?: number;
};

type Props = {
  items: QueryBatchItem[];
  messages: string[];
  tableHint?: string;
};

type TabId =
  | "message"
  | "summary"
  | `result-${number}`
  | `explain-${number}`;

export function QueryResultPanel({ items, messages, tableHint }: Props) {
  const resultItems = useMemo(
    () => items.filter((i) => i.kind === "result" && i.result),
    [items],
  );
  const explainItems = useMemo(
    () => items.filter((i) => i.kind === "explain" && i.result),
    [items],
  );

  const [active, setActive] = useState<TabId>("summary");

  useEffect(() => {
    if (resultItems.length > 0) {
      setActive("result-0");
    } else if (explainItems.length > 0) {
      setActive("explain-0");
    } else if (messages.length > 0 || items.some((i) => i.error)) {
      setActive("message");
    } else {
      setActive("summary");
    }
  }, [items, resultItems.length, explainItems.length, messages.length]);

  const activeResult = (() => {
    if (active.startsWith("result-")) {
      const idx = Number(active.slice("result-".length));
      return resultItems[idx]?.result ?? null;
    }
    if (active.startsWith("explain-")) {
      const idx = Number(active.slice("explain-".length));
      return explainItems[idx]?.result ?? null;
    }
    return null;
  })();

  const totalMs = items.reduce(
    (s, i) => s + (i.result?.elapsedMs ?? i.elapsedMs ?? 0),
    0,
  );
  const okCount = items.filter((i) => !i.error).length;
  const errCount = items.filter((i) => i.error).length;

  return (
    <div className="qrp-panel">
      <div className="qrp-tabs" role="tablist">
        <button
          type="button"
          className={active === "message" ? "is-active" : ""}
          onClick={() => setActive("message")}
        >
          消息
        </button>
        <button
          type="button"
          className={active === "summary" ? "is-active" : ""}
          onClick={() => setActive("summary")}
        >
          摘要
        </button>
        {resultItems.map((_, i) => (
          <button
            key={`r-${i}`}
            type="button"
            className={active === `result-${i}` ? "is-active" : ""}
            onClick={() => setActive(`result-${i}`)}
          >
            结果 {i + 1}
          </button>
        ))}
        {explainItems.map((_, i) => (
          <button
            key={`e-${i}`}
            type="button"
            className={active === `explain-${i}` ? "is-active" : ""}
            onClick={() => setActive(`explain-${i}`)}
          >
            解释 {i + 1}
          </button>
        ))}
      </div>

      <div className="qrp-body">
        {active === "message" && (
          <div className="qrp-message">
            {messages.length === 0 && items.length === 0 && (
              <p className="is-muted">暂无消息</p>
            )}
            {messages.map((m, i) => (
              <pre key={`m-${i}`} className="qrp-line">
                {m}
              </pre>
            ))}
            {items.map((it, i) =>
              it.error ? (
                <pre key={it.id} className="qrp-line is-error">
                  [{i + 1}] ERROR: {it.error}
                  {"\n"}
                  {it.sql}
                </pre>
              ) : (
                <pre key={it.id} className="qrp-line is-ok">
                  [{i + 1}] OK · {it.result?.rows.length ?? 0} 行 ·{" "}
                  {it.result?.elapsedMs ?? it.elapsedMs ?? 0} ms
                  {"\n"}
                  {it.sql.length > 120 ? `${it.sql.slice(0, 120)}…` : it.sql}
                </pre>
              ),
            )}
          </div>
        )}

        {active === "summary" && (
          <div className="qrp-summary">
            <dl>
              <div>
                <dt>语句数</dt>
                <dd>{items.length}</dd>
              </div>
              <div>
                <dt>成功</dt>
                <dd>{okCount}</dd>
              </div>
              <div>
                <dt>失败</dt>
                <dd>{errCount}</dd>
              </div>
              <div>
                <dt>结果集</dt>
                <dd>{resultItems.length}</dd>
              </div>
              <div>
                <dt>总耗时</dt>
                <dd>{totalMs} ms</dd>
              </div>
            </dl>
            <ol className="qrp-summary-list">
              {items.map((it, i) => (
                <li key={it.id}>
                  <strong>#{i + 1}</strong>{" "}
                  {it.error ? (
                    <span className="is-error">失败 — {it.error}</span>
                  ) : (
                    <span>
                      {it.kind === "explain" ? "解释" : "结果"} ·{" "}
                      {it.result?.rows.length ?? 0} 行 ·{" "}
                      {it.result?.elapsedMs ?? 0} ms
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}

        {activeResult && (
          <QueryResultGrid
            result={activeResult}
            tableHint={tableHint}
            embedded
          />
        )}
      </div>
    </div>
  );
}

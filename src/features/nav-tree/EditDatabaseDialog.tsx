import { useEffect, useMemo, useState } from "react";
import { loadMysqlCharsets } from "../table-designer/loadColumns";
import {
  MYSQL_CHARSETS,
  MYSQL_COLLATIONS_BY_CHARSET,
  collationsForCharset,
  defaultCollationForCharset,
} from "../table-designer/mysqlCharsets";

type Props = {
  database: string;
  connectionId?: string;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (charset: string, collate: string) => void;
};

export function EditDatabaseDialog({
  database,
  connectionId,
  busy = false,
  onCancel,
  onSubmit,
}: Props) {
  const [charset, setCharset] = useState("utf8mb4");
  const [collate, setCollate] = useState("utf8mb4_unicode_ci");
  const [charsetList, setCharsetList] = useState<string[]>([...MYSQL_CHARSETS]);
  const [collationMap, setCollationMap] = useState<Record<string, string[]>>(
    MYSQL_COLLATIONS_BY_CHARSET,
  );

  useEffect(() => {
    if (!connectionId) return;
    void loadMysqlCharsets({ connectionId })
      .then((cs) => {
        if (cs.charsets.length) setCharsetList(cs.charsets);
        if (Object.keys(cs.collationsByCharset).length) {
          setCollationMap(cs.collationsByCharset);
        }
      })
      .catch(() => {
        /* keep defaults */
      });
  }, [connectionId]);

  const collationChoices = useMemo(() => {
    const fromServer = collationMap[charset];
    if (fromServer?.length) return fromServer;
    return collationsForCharset(charset);
  }, [collationMap, charset]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          const cs = charset.trim();
          if (!cs) return;
          onSubmit(cs, collate.trim() || defaultCollationForCharset(cs));
        }}
      >
        <h2>编辑数据库「{database}」</h2>
        <label>
          字符集
          <select
            value={charset}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.value;
              setCharset(next);
              const list = collationMap[next] || collationsForCharset(next);
              setCollate(list[0] || defaultCollationForCharset(next));
            }}
          >
            {!charsetList.includes(charset) && charset && (
              <option value={charset}>{charset}</option>
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
            value={collate}
            disabled={busy}
            onChange={(e) => setCollate(e.target.value)}
          >
            {!collationChoices.includes(collate) && collate && (
              <option value={collate}>{collate}</option>
            )}
            {collationChoices.map((cl) => (
              <option key={cl} value={cl}>
                {cl}
              </option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button type="submit" disabled={busy || !charset.trim()}>
            {busy ? "应用中…" : "确定"}
          </button>
        </div>
      </form>
    </div>
  );
}

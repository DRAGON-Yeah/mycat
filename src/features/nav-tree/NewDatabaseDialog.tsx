import { useEffect, useMemo, useRef, useState } from "react";
import { loadMysqlCharsets } from "../table-designer/loadColumns";
import {
  MYSQL_CHARSETS,
  MYSQL_COLLATIONS_BY_CHARSET,
  collationsForCharset,
  defaultCollationForCharset,
} from "../table-designer/mysqlCharsets";

type Props = {
  connectionId?: string;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (args: {
    name: string;
    charset: string;
    collate: string;
  }) => void;
};

export function NewDatabaseDialog({
  connectionId,
  busy = false,
  onCancel,
  onSubmit,
}: Props) {
  const [name, setName] = useState("");
  const [charset, setCharset] = useState("utf8mb4");
  const [collate, setCollate] = useState("utf8mb4_unicode_ci");
  const [charsetList, setCharsetList] = useState<string[]>([...MYSQL_CHARSETS]);
  const [collationMap, setCollationMap] = useState<Record<string, string[]>>(
    MYSQL_COLLATIONS_BY_CHARSET,
  );
  const inputRef = useRef<HTMLInputElement>(null);

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
          const n = name.trim();
          if (!n) return;
          onSubmit({
            name: n,
            charset: charset.trim() || "utf8mb4",
            collate: collate.trim() || defaultCollationForCharset(charset),
          });
        }}
      >
        <h2>新建数据库</h2>
        <label>
          数据库名称
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my_database"
            disabled={busy}
            autoComplete="off"
            autoFocus
          />
        </label>
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
          <button type="submit" disabled={busy || !name.trim()}>
            {busy ? "创建中…" : "创建"}
          </button>
        </div>
      </form>
    </div>
  );
}

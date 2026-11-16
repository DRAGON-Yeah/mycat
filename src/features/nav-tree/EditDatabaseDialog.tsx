import { useRef, useState } from "react";

type Props = {
  database: string;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (charset: string, collate: string) => void;
};

export function EditDatabaseDialog({
  database,
  busy = false,
  onCancel,
  onSubmit,
}: Props) {
  const [charset, setCharset] = useState("utf8mb4");
  const [collate, setCollate] = useState("utf8mb4_general_ci");
  const charsetRef = useRef<HTMLInputElement>(null);

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
          onSubmit(cs, collate.trim());
        }}
      >
        <h2>编辑数据库「{database}」</h2>
        <label>
          字符集
          <input
            ref={charsetRef}
            value={charset}
            onChange={(e) => setCharset(e.target.value)}
            placeholder="utf8mb4"
            disabled={busy}
            autoComplete="off"
          />
        </label>
        <label>
          排序规则
          <input
            value={collate}
            onChange={(e) => setCollate(e.target.value)}
            placeholder="utf8mb4_general_ci"
            disabled={busy}
            autoComplete="off"
          />
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

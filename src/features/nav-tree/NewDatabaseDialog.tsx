import { useRef, useState } from "react";

type Props = {
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => void;
};

export function NewDatabaseDialog({ busy = false, onCancel, onSubmit }: Props) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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
          onSubmit(n);
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

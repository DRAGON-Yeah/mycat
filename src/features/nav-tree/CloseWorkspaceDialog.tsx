import type { QueryTab, TableTab } from "../../stores/workspaceStore";

type Props = {
  title: string;
  dirtyTables: TableTab[];
  dirtyQueries: QueryTab[];
  busy?: boolean;
  onSaveAndClose: () => void;
  onDiscardAndClose: () => void;
  onCancel: () => void;
};

export function CloseWorkspaceDialog({
  title,
  dirtyTables,
  dirtyQueries,
  busy = false,
  onSaveAndClose,
  onDiscardAndClose,
  onCancel,
}: Props) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="modal close-db-dialog" role="dialog" aria-modal="true">
        <h2>{title}</h2>
        <p className="save-query-hint">
          以下内容尚未保存。查询可在此自动保存；表数据需在网格中保存，否则「保存并关闭」会先跳转到对应表。
        </p>
        <ul className="close-db-dirty-list">
          {dirtyQueries.map((q) => (
            <li key={q.id}>
              查询 · {q.title || "无标题"}
              {q.dirty ? "（已修改）" : ""}
            </li>
          ))}
          {dirtyTables.map((t) => (
            <li key={t.id}>
              表 · {t.table}
              {t.dirty ? "（未保存行编辑）" : ""}
            </li>
          ))}
        </ul>
        <div className="modal-actions close-db-actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button type="button" disabled={busy} onClick={onDiscardAndClose}>
            不保存并关闭
          </button>
          <button
            type="button"
            className="close-db-primary"
            disabled={busy}
            onClick={onSaveAndClose}
          >
            {busy ? "处理中…" : "保存并关闭"}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useRef, useState } from "react";
import { downloadTextFile } from "../import-export/csv";
import { importConnections, type ConnectionExportItem } from "./api";

type Props = {
  onClose: () => void;
  onImported: (count: number) => void;
};

const TEMPLATE: ConnectionExportItem[] = [
  {
    name: "Local-mysql",
    engine: "mysql",
    host: "127.0.0.1",
    port: 3306,
    database: null,
    user: "root",
    sslMode: "disable",
    sshEnabled: false,
    sshHost: null,
    sshPort: null,
    sshUser: null,
    color: "#0969da",
    starred: false,
    groupName: "开发",
    hidden: false,
    password: null,
  },
];

export function ImportConnectionsDialog({ onClose, onImported }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function downloadTemplate() {
    downloadTextFile(
      "mycat-connections-template.json",
      `${JSON.stringify(TEMPLATE, null, 2)}\n`,
      "application/json",
    );
  }

  async function onPickFile(file: File) {
    setError(null);
    setFileName(file.name);
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("模板应为 JSON 数组");
      }
      const count = await importConnections(parsed as ConnectionExportItem[]);
      onImported(count);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal import-conn-dialog" role="dialog" aria-modal="true">
        <h2>导入连接</h2>
        <p className="save-query-hint">
          先下载 JSON 模板并按格式填写（不含密码），再上传导入。导入后请在编辑连接中补填密码。
        </p>
        <ol className="import-conn-steps">
          <li>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy}
              onClick={downloadTemplate}
            >
              下载模板
            </button>
            <span className="is-muted">mycat-connections-template.json</span>
          </li>
          <li>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? "导入中…" : "选择文件上传"}
            </button>
            <span className="is-muted">{fileName ?? "未选择文件"}</span>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onPickFile(file);
              }}
            />
          </li>
        </ol>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

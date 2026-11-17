import { useRef, useState } from "react";
import { downloadTextFile, isSaveCancelled } from "../import-export/csv";
import { importConnections, type ConnectionExportItem } from "./api";
import { confirmDialog } from "../../lib/confirm";

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

type Picked = {
  file: File;
  items: ConnectionExportItem[];
};

export function ImportConnectionsDialog({ onClose, onImported }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function downloadTemplate() {
    setError(null);
    try {
      const path = await downloadTextFile(
        "mycat-connections-template.json",
        `${JSON.stringify(TEMPLATE, null, 2)}\n`,
        "application/json",
      );
      setDownloaded(true);
      setInfo(`模板已保存：${path}`);
    } catch (err) {
      if (isSaveCancelled(err)) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function acceptFile(next: File | null) {
    setError(null);
    setInfo(null);
    setPicked(null);
    if (!next) return;

    if (!/\.json$/i.test(next.name) && next.type && next.type !== "application/json") {
      setError("请选择 .json 文件");
      return;
    }

    try {
      const text = await next.text();
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("文件内容应为 JSON 数组，请使用下载的模板格式");
      }
      if (parsed.length === 0) {
        throw new Error("文件中没有连接条目");
      }
      setPicked({ file: next, items: parsed as ConnectionExportItem[] });
      setInfo(`已选择「${next.name}」，检测到 ${parsed.length} 条连接，确认无误后点击「开始导入」。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onImport() {
    if (!picked) return;
    const ok = await confirmDialog({
      title: "导入连接",
      message: `即将导入 ${picked.items.length} 条连接。\n\n密码不会随文件导入，导入后请在「编辑连接」中补填。\n\n是否继续？`,
      confirmText: "开始导入",
    });
    if (!ok) {
      setInfo("已取消导入，可重新选择文件或修改后再试。");
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const count = await importConnections(picked.items);
      setInfo(`导入成功：已新增 ${count} 条连接。`);
      onImported(count);
      window.setTimeout(() => onClose(), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
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
          按模板填写连接信息后上传。文件不含密码，导入后请在「编辑连接」中补填。
        </p>

        <div className={`import-conn-card ${downloaded ? "is-done" : ""}`}>
          <div className="import-conn-card-head">
            <span className="import-conn-step">{downloaded ? "✓" : "1"}</span>
            <div>
              <strong>下载模板</strong>
              <p>获取 JSON 示例并按字段填写</p>
            </div>
          </div>
          <button
            type="button"
            className="import-conn-btn"
            disabled={busy}
            onClick={() => void downloadTemplate()}
          >
            {downloaded ? "再次下载模板" : "下载 mycat-connections-template.json"}
          </button>
          {downloaded && (
            <p className="import-conn-banner is-ok">
              已触发下载，请到系统「下载」文件夹查找该文件。
            </p>
          )}
        </div>

        <div className={`import-conn-card ${picked ? "is-done" : ""}`}>
          <div className="import-conn-card-head">
            <span className="import-conn-step">{picked ? "✓" : "2"}</span>
            <div>
              <strong>选择文件</strong>
              <p>支持拖拽或点击选择 .json</p>
            </div>
          </div>
          <button
            type="button"
            className={`import-conn-drop ${dragOver ? "is-drag" : ""} ${picked ? "has-file" : ""}`}
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const next = e.dataTransfer.files?.[0] ?? null;
              void acceptFile(next);
            }}
          >
            {picked ? (
              <>
                <span className="import-conn-file">{picked.file.name}</span>
                <span className="import-conn-hint">
                  共 {picked.items.length} 条 · 点击可重新选择
                </span>
              </>
            ) : (
              <>
                <span className="import-conn-file">将文件拖到此处，或点击选择</span>
                <span className="import-conn-hint">仅支持 .json</span>
              </>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const next = e.target.files?.[0] ?? null;
              e.target.value = "";
              void acceptFile(next);
            }}
          />
        </div>

        {info && <p className="form-info import-conn-feedback">{info}</p>}
        {error && <p className="form-error import-conn-feedback">{error}</p>}

        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="import-conn-primary"
            disabled={busy || !picked}
            onClick={() => void onImport()}
          >
            {busy
              ? "导入中…"
              : picked
                ? `开始导入（${picked.items.length}）`
                : "开始导入"}
          </button>
        </div>
      </div>
    </div>
  );
}

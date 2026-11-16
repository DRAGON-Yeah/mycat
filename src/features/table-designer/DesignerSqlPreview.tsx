import Editor from "@monaco-editor/react";
import { useMemo, useState } from "react";
import { useUiStore } from "../../stores/uiStore";

type PreviewMode = "changes" | "ddl";

type Props = {
  /** Pending ALTER / CREATE-as-change SQL */
  changesSql: string;
  /** Full CREATE TABLE DDL from current designer state */
  ddlSql: string;
  /** create mode: default to DDL; alter: default to changes */
  defaultMode?: PreviewMode;
};

export function DesignerSqlPreview({
  changesSql,
  ddlSql,
  defaultMode = "ddl",
}: Props) {
  const theme = useUiStore((s) => s.theme);
  const [mode, setMode] = useState<PreviewMode>(defaultMode);
  const monacoTheme = useMemo(
    () => (theme === "dark" ? "vs-dark" : "light"),
    [theme],
  );
  const value = mode === "changes" ? changesSql : ddlSql;

  return (
    <div className="td-sql-pane">
      <div className="td-sql-mode-bar" role="tablist" aria-label="SQL 预览模式">
        <button
          type="button"
          role="tab"
          className={mode === "changes" ? "is-active" : ""}
          aria-selected={mode === "changes"}
          onClick={() => setMode("changes")}
        >
          更改
        </button>
        <button
          type="button"
          role="tab"
          className={mode === "ddl" ? "is-active" : ""}
          aria-selected={mode === "ddl"}
          onClick={() => setMode("ddl")}
        >
          DDL
        </button>
      </div>
      <div className="td-sql-editor">
        <Editor
          height="100%"
          defaultLanguage="sql"
          language="sql"
          theme={monacoTheme}
          value={value}
          options={{
            readOnly: true,
            domReadOnly: true,
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            glyphMargin: false,
            folding: true,
            wordWrap: "off",
            automaticLayout: true,
            scrollBeyondLastLine: false,
            renderLineHighlight: "line",
            padding: { top: 8, bottom: 8 },
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
            scrollbar: {
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10,
            },
            contextmenu: false,
            quickSuggestions: false,
            suggestOnTriggerCharacters: false,
            wordBasedSuggestions: "off",
          }}
        />
      </div>
    </div>
  );
}

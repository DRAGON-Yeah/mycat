import { useWorkspaceStore } from "../../stores/workspaceStore";
import { IconEngine } from "../nav-tree/EngineIcons";

export function InspectorPane() {
  const connection = useWorkspaceStore((s) => s.activeConnection);
  const database = useWorkspaceStore((s) => s.selectedDatabase);
  const table = useWorkspaceStore((s) => s.selectedTable);
  const kind = useWorkspaceStore((s) => s.selectionKind);
  const centerMode = useWorkspaceStore((s) => s.centerMode);
  const activeQueryId = useWorkspaceStore((s) => s.activeQueryId);
  const queryTabs = useWorkspaceStore((s) => s.queryTabs);
  const activeQuery = queryTabs.find((t) => t.id === activeQueryId) ?? null;

  if (kind === "none" || !connection) {
    return (
      <aside className="pane inspector-pane" aria-label="信息">
        <div className="pane-title">信息</div>
        <p className="pane-placeholder">选中连接、数据库或表以查看详情。</p>
      </aside>
    );
  }

  if (kind === "table" && table) {
    return (
      <aside className="pane inspector-pane" aria-label="信息">
        <div className="pane-title">表</div>
        <div className="inspector-hero">
          <div className="inspector-badge">T</div>
          <h3>{table}</h3>
        </div>
        <dl className="inspector-meta">
          <div>
            <dt>连接</dt>
            <dd>{connection.name}</dd>
          </div>
          <div>
            <dt>数据库</dt>
            <dd>{database ?? "—"}</dd>
          </div>
          <div>
            <dt>引擎</dt>
            <dd>{connection.engine}</dd>
          </div>
        </dl>
      </aside>
    );
  }

  if (kind === "database" && database && centerMode !== "query") {
    return (
      <aside className="pane inspector-pane" aria-label="信息">
        <div className="pane-title">数据库</div>
        <div className="inspector-hero">
          <div className="inspector-badge db">D</div>
          <h3>{database}</h3>
        </div>
        <dl className="inspector-meta">
          <div>
            <dt>连接</dt>
            <dd>{connection.name}</dd>
          </div>
          <div>
            <dt>主机</dt>
            <dd>{connection.host ?? "—"}</dd>
          </div>
          <div>
            <dt>引擎</dt>
            <dd>{connection.engine}</dd>
          </div>
        </dl>
      </aside>
    );
  }

  return (
    <aside className="pane inspector-pane" aria-label="信息">
      <div className="pane-title">连接</div>
      <div className="inspector-hero">
        <div className="inspector-badge conn inspector-engine-badge">
          <IconEngine engine={connection.engine} active large />
        </div>
        <h3>{connection.name}</h3>
      </div>
      <dl className="inspector-meta">
        <div>
          <dt>引擎</dt>
          <dd>{connection.engine}</dd>
        </div>
        <div>
          <dt>主机</dt>
          <dd>{connection.host ?? "—"}</dd>
        </div>
        <div>
          <dt>端口</dt>
          <dd>{connection.port ?? "—"}</dd>
        </div>
        <div>
          <dt>数据库</dt>
          <dd>{connection.database?.trim() || "—"}</dd>
        </div>
        <div>
          <dt>用户名</dt>
          <dd>{connection.user ?? "—"}</dd>
        </div>
        <div>
          <dt>分组</dt>
          <dd>{connection.groupName ?? "—"}</dd>
        </div>
        {centerMode === "query" && activeQuery && (
          <div>
            <dt>查询库</dt>
            <dd>{activeQuery.database || "—"}</dd>
          </div>
        )}
      </dl>
    </aside>
  );
}

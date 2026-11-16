import type {
  DesignerTab,
  QueryTab,
  TableTab,
} from "../../stores/workspaceStore";
import { CloseWorkspaceDialog } from "./CloseWorkspaceDialog";

type Props = {
  database: string;
  dirtyTables: TableTab[];
  dirtyQueries: QueryTab[];
  dirtyDesigners?: DesignerTab[];
  busy?: boolean;
  onSaveAndClose: () => void;
  onDiscardAndClose: () => void;
  onCancel: () => void;
};

export function CloseDatabaseDialog({
  database,
  dirtyTables,
  dirtyQueries,
  dirtyDesigners,
  busy,
  onSaveAndClose,
  onDiscardAndClose,
  onCancel,
}: Props) {
  return (
    <CloseWorkspaceDialog
      title={`关闭数据库「${database}」`}
      dirtyTables={dirtyTables}
      dirtyQueries={dirtyQueries}
      dirtyDesigners={dirtyDesigners}
      busy={busy}
      onSaveAndClose={onSaveAndClose}
      onDiscardAndClose={onDiscardAndClose}
      onCancel={onCancel}
    />
  );
}

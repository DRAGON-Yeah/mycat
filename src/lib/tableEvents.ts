/** Broadcast when table data/structure changed so open grids can reload. */

export const TABLE_DATA_CHANGED = "mycat:table-data-changed";

export type TableDataChangedDetail = {
  connectionId: string;
  database: string;
  table: string;
};

export function emitTableDataChanged(detail: TableDataChangedDetail) {
  window.dispatchEvent(
    new CustomEvent<TableDataChangedDetail>(TABLE_DATA_CHANGED, { detail }),
  );
}

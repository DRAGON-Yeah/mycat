import {
  listTables,
  openConnection,
} from "../connections/sessionApi";
import { listEventMeta } from "../object-list/eventMeta";
import { listRoutineMeta } from "../object-list/routineMeta";
import { listViewMeta } from "../object-list/viewMeta";

export type BackupObjectKind = "table" | "view" | "function" | "event";

export type BackupObjectNode = {
  kind: BackupObjectKind;
  name: string;
  key: string;
};

export type BackupObjectGroup = {
  kind: BackupObjectKind;
  label: string;
  items: BackupObjectNode[];
};

export function objectKey(kind: BackupObjectKind, name: string) {
  return `${kind}:${name}`;
}

export async function listBackupObjectGroups(args: {
  connectionId: string;
  engine: string;
  database: string;
}): Promise<BackupObjectGroup[]> {
  const { connectionId, engine, database } = args;
  await openConnection(connectionId);

  const tables = await listTables(connectionId, database);
  const baseTables = tables
    .filter((t) => t.kind !== "view")
    .map((t) => ({
      kind: "table" as const,
      name: t.name,
      key: objectKey("table", t.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh"));

  let views: BackupObjectNode[] = tables
    .filter((t) => t.kind === "view")
    .map((t) => ({
      kind: "view" as const,
      name: t.name,
      key: objectKey("view", t.name),
    }));
  try {
    const vm = await listViewMeta({ connectionId, engine, database });
    const names = new Set(views.map((v) => v.name));
    for (const name of Object.keys(vm)) {
      if (!names.has(name)) {
        views.push({
          kind: "view",
          name,
          key: objectKey("view", name),
        });
      }
    }
  } catch {
    /* ignore */
  }
  views = views.sort((a, b) => a.name.localeCompare(b.name, "zh"));

  let functions: BackupObjectNode[] = [];
  try {
    const rm = await listRoutineMeta({ connectionId, engine, database });
    functions = Object.values(rm)
      .map((r) => ({
        kind: "function" as const,
        name: r.name,
        key: objectKey("function", r.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh"));
  } catch {
    functions = [];
  }

  let events: BackupObjectNode[] = [];
  try {
    const em = await listEventMeta({ connectionId, engine, database });
    events = Object.values(em)
      .map((ev) => ({
        kind: "event" as const,
        name: ev.name,
        key: objectKey("event", ev.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh"));
  } catch {
    events = [];
  }

  return [
    { kind: "table", label: "表", items: baseTables },
    { kind: "view", label: "视图", items: views },
    { kind: "function", label: "函数", items: functions },
    { kind: "event", label: "事件", items: events },
  ];
}

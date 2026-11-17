import { newId, nowIso, readJson, writeJson } from "../../lib/localDocs";
import type { BiDashboard } from "./types";

const DASH_KEY = "mycat_bi_dashboards";

export const BI_CHANGED = "mycat:bi-changed";

function emit() {
  window.dispatchEvent(new Event(BI_CHANGED));
}

function readAll(): BiDashboard[] {
  const items = readJson<BiDashboard[]>(DASH_KEY, []);
  return Array.isArray(items) ? items.filter((d) => d && d.id) : [];
}

function writeAll(items: BiDashboard[]) {
  writeJson(DASH_KEY, items);
}

export function listDashboards(): BiDashboard[] {
  return readAll().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getDashboard(id: string): BiDashboard | null {
  return readAll().find((d) => d.id === id) ?? null;
}

export function saveDashboard(dash: BiDashboard): BiDashboard {
  const next: BiDashboard = { ...dash, updatedAt: nowIso() };
  const items = readAll();
  const idx = items.findIndex((d) => d.id === next.id);
  if (idx >= 0) items[idx] = next;
  else items.push(next);
  writeAll(items);
  emit();
  return next;
}

export function deleteDashboard(id: string): void {
  writeAll(readAll().filter((d) => d.id !== id));
  emit();
}

export function duplicateDashboard(id: string): BiDashboard | null {
  const src = getDashboard(id);
  if (!src) return null;
  const at = nowIso();
  const copy: BiDashboard = {
    ...src,
    id: newId("dash"),
    name: `${src.name} 副本`,
    createdAt: at,
    updatedAt: at,
    widgets: src.widgets.map((w) => ({ ...w, id: newId("widget") })),
  };
  writeAll([...readAll(), copy]);
  emit();
  return copy;
}

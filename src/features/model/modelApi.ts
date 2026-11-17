import { newId, nowIso, readJson, writeJson } from "../../lib/localDocs";
import type { DataModel } from "./types";

const MODELS_KEY = "mycat_models";

export const MODEL_CHANGED = "mycat:model-changed";

function emit() {
  window.dispatchEvent(new Event(MODEL_CHANGED));
}

function readModels(): DataModel[] {
  const items = readJson<DataModel[]>(MODELS_KEY, []);
  return Array.isArray(items) ? items.filter((m) => m && m.id) : [];
}

function writeModels(items: DataModel[]) {
  writeJson(MODELS_KEY, items);
}

export function listModels(): DataModel[] {
  return readModels().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getModel(id: string): DataModel | null {
  return readModels().find((m) => m.id === id) ?? null;
}

export function saveModel(model: DataModel): DataModel {
  const next: DataModel = { ...model, updatedAt: nowIso() };
  const items = readModels();
  const idx = items.findIndex((m) => m.id === next.id);
  if (idx >= 0) items[idx] = next;
  else items.push(next);
  writeModels(items);
  emit();
  return next;
}

export function deleteModel(id: string): void {
  writeModels(readModels().filter((m) => m.id !== id));
  emit();
}

export function duplicateModel(id: string): DataModel | null {
  const src = getModel(id);
  if (!src) return null;
  const at = nowIso();
  const copy: DataModel = {
    ...src,
    id: newId("model"),
    name: `${src.name} 副本`,
    createdAt: at,
    updatedAt: at,
    tables: src.tables.map((t) => ({ ...t, id: newId("mt") })),
    links: [],
  };
  writeModels([...readModels(), copy]);
  emit();
  return copy;
}

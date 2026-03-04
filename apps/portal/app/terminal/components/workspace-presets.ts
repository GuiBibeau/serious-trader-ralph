import type { TerminalModule } from "../terminal-modes";

export type WorkspaceModuleVisibility = Record<TerminalModule, boolean>;

export type CustomWorkspacePreset = {
  id: string;
  name: string;
  modules: WorkspaceModuleVisibility;
  createdAtIso: string;
  updatedAtIso: string;
};

export type CustomWorkspaceStore = {
  activeId: string;
  presets: CustomWorkspacePreset[];
};

export const CUSTOM_WORKSPACE_STORAGE_KEY = "terminal.custom.workspaces.v1";
export const CUSTOM_WORKSPACE_ID_DEFAULT = "default";

export const CUSTOM_WORKSPACE_MODULES: readonly TerminalModule[] = [
  "market",
  "wallet",
  "macro_radar",
  "macro_fred",
  "macro_etf",
  "macro_stablecoin",
  "macro_oil",
];

export function defaultWorkspaceModules(): WorkspaceModuleVisibility {
  return {
    market: true,
    wallet: true,
    macro_radar: true,
    macro_fred: true,
    macro_etf: true,
    macro_stablecoin: true,
    macro_oil: true,
  };
}

export function sanitizeWorkspaceModules(
  raw: unknown,
): WorkspaceModuleVisibility {
  const defaults = defaultWorkspaceModules();
  if (!raw || typeof raw !== "object") return defaults;
  const record = raw as Record<string, unknown>;
  const next: WorkspaceModuleVisibility = {
    market: record.market === true,
    wallet: record.wallet === true,
    macro_radar: record.macro_radar === true,
    macro_fred: record.macro_fred === true,
    macro_etf: record.macro_etf === true,
    macro_stablecoin: record.macro_stablecoin === true,
    macro_oil: record.macro_oil === true,
  };

  if (Object.values(next).some(Boolean)) return next;
  return {
    ...next,
    market: true,
  };
}

export function createWorkspacePreset(input?: {
  id?: string;
  name?: string;
  modules?: WorkspaceModuleVisibility;
  nowIso?: string;
}): CustomWorkspacePreset {
  const nowIso = input?.nowIso ?? new Date().toISOString();
  const modules = sanitizeWorkspaceModules(input?.modules ?? null);
  const id = String(input?.id ?? "").trim() || crypto.randomUUID();
  const fallbackName =
    id === CUSTOM_WORKSPACE_ID_DEFAULT ? "Default workspace" : "Workspace";
  const name = String(input?.name ?? "").trim() || fallbackName;
  return {
    id,
    name,
    modules,
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
  };
}

export function createDefaultWorkspaceStore(): CustomWorkspaceStore {
  const preset = createWorkspacePreset({
    id: CUSTOM_WORKSPACE_ID_DEFAULT,
    name: "Default workspace",
  });
  return {
    activeId: preset.id,
    presets: [preset],
  };
}

function sanitizeWorkspacePreset(
  raw: unknown,
  index: number,
): CustomWorkspacePreset | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const fallbackId = `workspace-${index + 1}`;
  const id = String(record.id ?? fallbackId).trim() || fallbackId;
  const name = String(record.name ?? "").trim() || `Workspace ${index + 1}`;
  const createdAtIso = String(record.createdAtIso ?? "").trim();
  const updatedAtIso = String(record.updatedAtIso ?? "").trim();
  return {
    id,
    name,
    modules: sanitizeWorkspaceModules(record.modules ?? null),
    createdAtIso: createdAtIso || new Date().toISOString(),
    updatedAtIso: updatedAtIso || new Date().toISOString(),
  };
}

export function parseCustomWorkspaceStore(raw: unknown): CustomWorkspaceStore {
  if (!raw || typeof raw !== "object") return createDefaultWorkspaceStore();
  const record = raw as Record<string, unknown>;
  const presetsRaw = Array.isArray(record.presets) ? record.presets : [];
  const unique = new Map<string, CustomWorkspacePreset>();

  presetsRaw.forEach((item, index) => {
    const parsed = sanitizeWorkspacePreset(item, index);
    if (!parsed) return;
    if (unique.has(parsed.id)) return;
    unique.set(parsed.id, parsed);
  });

  const presets = Array.from(unique.values());
  if (presets.length < 1) return createDefaultWorkspaceStore();

  const activeIdRaw = String(record.activeId ?? "").trim();
  const activeId = unique.has(activeIdRaw) ? activeIdRaw : presets[0].id;
  return {
    activeId,
    presets,
  };
}

export function resolveActiveWorkspace(
  store: CustomWorkspaceStore,
): CustomWorkspacePreset {
  const explicit = store.presets.find((item) => item.id === store.activeId);
  if (explicit) return explicit;
  const fallback = store.presets[0];
  if (fallback) return fallback;
  return createDefaultWorkspaceStore().presets[0];
}

export function buildCustomWorkspaceLayoutStorageKey(
  workspaceId: string,
): string {
  const normalized = String(workspaceId).trim() || CUSTOM_WORKSPACE_ID_DEFAULT;
  return `dashboard-grid-layouts:v6:custom:${normalized}`;
}

export function readCustomWorkspaceStoreFromLocalStorage(): CustomWorkspaceStore {
  if (typeof window === "undefined") return createDefaultWorkspaceStore();
  try {
    const raw = window.localStorage.getItem(CUSTOM_WORKSPACE_STORAGE_KEY);
    if (!raw) return createDefaultWorkspaceStore();
    return parseCustomWorkspaceStore(JSON.parse(raw));
  } catch {
    return createDefaultWorkspaceStore();
  }
}

export function writeCustomWorkspaceStoreToLocalStorage(
  store: CustomWorkspaceStore,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CUSTOM_WORKSPACE_STORAGE_KEY,
      JSON.stringify(store),
    );
  } catch {
    // Ignore storage errors and keep runtime behavior deterministic.
  }
}

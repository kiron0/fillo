import { runtimeSendMessage } from "./chrome-api";
import {
  clearAllDataDirect,
  clearHistoryDirect,
  deletePresetDirect,
  deleteProfileDirect,
  importAppDataDirect,
  readAllDirect,
  readHistoryDirect,
  readPresetsDirect,
  readProfilesDirect,
  readSettingsDirect,
  saveHistoryEntryDirect,
  savePresetDirect,
  saveProfileDirect,
  saveSettingsDirect,
} from "./storage-ops";
import { DEFAULT_EXPORT_SELECTION } from "./types";
import type {
  AppSettings,
  ExportSelection,
  ExportedAppData,
  FormHistoryEntry,
  FormPreset,
  ImportedAppData,
  MessageResponse,
  Profile,
} from "./types";
import type { BackgroundRequest } from "./types";

const STORAGE_WRITE_LOCK_NAME = "fillo-storage-write";
const UNSUPPORTED_IMPORT_ERROR = "Import payload must be a version 1 backup.";
const MALFORMED_IMPORT_ERROR = "Import payload must be a valid version 1 backup with well-formed profiles, presets, settings, and history.";

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPartialExportSelection(value: unknown): value is Partial<ExportSelection> {
  return (
    isStringRecord(value) &&
    ((value as Partial<ExportSelection>).profiles === undefined || typeof (value as Partial<ExportSelection>).profiles === "boolean") &&
    ((value as Partial<ExportSelection>).presets === undefined || typeof (value as Partial<ExportSelection>).presets === "boolean") &&
    ((value as Partial<ExportSelection>).settings === undefined || typeof (value as Partial<ExportSelection>).settings === "boolean") &&
    ((value as Partial<ExportSelection>).history === undefined || typeof (value as Partial<ExportSelection>).history === "boolean")
  );
}

async function runBackgroundMutation<T>(
  payload: Extract<BackgroundRequest, { type: "RUN_STORAGE_MUTATION" }>["payload"],
): Promise<T> {
  const response = await runtimeSendMessage<MessageResponse<T>>({
    type: "RUN_STORAGE_MUTATION",
    payload,
  });

  if (!response?.ok) {
    throw new Error(response?.error ?? "Background storage mutation failed");
  }

  return response.data as T;
}

async function runMutation<T>(
  payload: Extract<BackgroundRequest, { type: "RUN_STORAGE_MUTATION" }>["payload"],
  action: () => Promise<T>,
): Promise<T> {
  const lockManager = globalThis.navigator?.locks;
  if (lockManager && typeof lockManager.request === "function") {
    let actionStarted = false;
    let lockRequest: Promise<T>;
    try {
      lockRequest = lockManager.request(STORAGE_WRITE_LOCK_NAME, () => {
        actionStarted = true;
        return action();
      });
    } catch {
      // Fall through to the serialized background path when the lock manager is present but unusable.
      lockRequest = null as never;
    }

    if (lockRequest) {
      try {
        return await lockRequest;
      } catch (error) {
        if (actionStarted) {
          throw error;
        }
      }
    }
  }

  if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
    return runBackgroundMutation<T>(payload);
  }

  return action();
}

export async function getProfiles(): Promise<Profile[]> {
  return readProfilesDirect();
}

export async function saveProfile(profile: Profile): Promise<void> {
  await runMutation({ kind: "save_profile", profile }, () => saveProfileDirect(profile));
}

export async function deleteProfile(profileId: string): Promise<void> {
  await runMutation({ kind: "delete_profile", profileId }, () => deleteProfileDirect(profileId));
}

export async function getPresets(): Promise<FormPreset[]> {
  return readPresetsDirect();
}

export async function getPresetByFormKey(formKey: string): Promise<FormPreset | null> {
  return (await readPresetsDirect()).find((item) => item.formKey === formKey) ?? null;
}

export async function savePreset(preset: FormPreset): Promise<void> {
  await runMutation({ kind: "save_preset", preset }, () => savePresetDirect(preset));
}

export async function deletePreset(presetId: string): Promise<void> {
  await runMutation({ kind: "delete_preset", presetId }, () => deletePresetDirect(presetId));
}

export async function getSettings(): Promise<AppSettings> {
  return readSettingsDirect();
}

export async function getFormHistory(): Promise<FormHistoryEntry[]> {
  return readHistoryDirect();
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await runMutation({ kind: "save_settings", settings }, () => saveSettingsDirect(settings));
}

export async function saveHistoryEntry(entry: FormHistoryEntry): Promise<void> {
  await runMutation({ kind: "save_history_entry", entry }, () => saveHistoryEntryDirect(entry));
}

export async function clearHistory(): Promise<void> {
  await runMutation({ kind: "clear_history" }, () => clearHistoryDirect());
}

export async function clearAllData(): Promise<void> {
  await runMutation({ kind: "clear_all_data" }, () => clearAllDataDirect());
}

export async function exportAppData(selection: Partial<ExportSelection> = {}): Promise<ExportedAppData> {
  if (!isPartialExportSelection(selection)) {
    throw new Error("Export selection must contain only boolean backup section flags.");
  }

  const data = await readAllDirect();
  const resolvedSelection: ExportSelection = { ...DEFAULT_EXPORT_SELECTION, ...selection };
  return {
    version: 1,
    exportedAt: Date.now(),
    selection: resolvedSelection,
    ...(resolvedSelection.profiles ? { profiles: data.profiles } : {}),
    ...(resolvedSelection.presets ? { presets: data.presets } : {}),
    ...(resolvedSelection.settings ? { settings: data.settings } : {}),
    ...(resolvedSelection.history ? { history: data.history } : {}),
  };
}

export async function importAppData(payload: ImportedAppData, selection: Partial<ExportSelection> = {}): Promise<void> {
  if (!isStringRecord(payload)) {
    throw new Error(UNSUPPORTED_IMPORT_ERROR);
  }

  if ((payload.selection !== undefined && !isPartialExportSelection(payload.selection)) || !isPartialExportSelection(selection)) {
    throw new Error(MALFORMED_IMPORT_ERROR);
  }

  const resolvedSelection: ExportSelection = {
    ...DEFAULT_EXPORT_SELECTION,
    ...(payload.selection ?? {}),
    ...selection,
  };

  const nextPayload: ImportedAppData = {
    ...payload,
    selection: resolvedSelection,
    ...(resolvedSelection.profiles ? {} : { profiles: undefined }),
    ...(resolvedSelection.presets ? {} : { presets: undefined }),
    ...(resolvedSelection.settings ? {} : { settings: undefined }),
    ...(resolvedSelection.history ? {} : { history: undefined }),
  };

  await runMutation({ kind: "import_app_data", data: nextPayload }, () => importAppDataDirect(nextPayload));
}

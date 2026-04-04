import { runtimeSendMessage } from "./chrome-api";
import {
  clearAllDataDirect,
  deletePresetDirect,
  deleteProfileDirect,
  importAppDataDirect,
  readAllDirect,
  readPresetsDirect,
  readProfilesDirect,
  readSettingsDirect,
  savePresetDirect,
  saveProfileDirect,
  saveSettingsDirect,
} from "./storage-ops";
import type { AppSettings, ExportedAppData, FormPreset, ImportedAppData, MessageResponse, Profile } from "./types";
import type { BackgroundRequest } from "./types";

const STORAGE_WRITE_LOCK_NAME = "fillo-storage-write";

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
  const requestLock = globalThis.navigator?.locks?.request;
  if (requestLock) {
    return requestLock.call(globalThis.navigator.locks, STORAGE_WRITE_LOCK_NAME, async () => action());
  }

  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
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

export async function saveSettings(settings: AppSettings): Promise<void> {
  await runMutation({ kind: "save_settings", settings }, () => saveSettingsDirect(settings));
}

export async function clearAllData(): Promise<void> {
  await runMutation({ kind: "clear_all_data" }, () => clearAllDataDirect());
}

export async function exportAppData(): Promise<ExportedAppData> {
  const data = await readAllDirect();
  return {
    version: 1,
    exportedAt: Date.now(),
    profiles: data.profiles,
    presets: data.presets,
    settings: data.settings,
  };
}

export async function importAppData(payload: ImportedAppData): Promise<void> {
  await runMutation({ kind: "import_app_data", data: payload }, () => importAppDataDirect(payload));
}

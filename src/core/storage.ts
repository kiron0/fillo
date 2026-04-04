import type { AppSettings, ExportedAppData, FormPreset, ImportedAppData, Profile } from "./types";
import { storageGet, storageSet } from "./chrome-api";
import { DEFAULT_SETTINGS } from "./types";

const STORAGE_KEYS = {
  profiles: "profiles",
  presets: "presets",
  settings: "settings",
} as const;

type StorageShape = {
  [STORAGE_KEYS.profiles]?: Profile[];
  [STORAGE_KEYS.presets]?: FormPreset[];
  [STORAGE_KEYS.settings]?: AppSettings;
};

type StorageKeyName = keyof typeof STORAGE_KEYS;
const STORAGE_WRITE_LOCK_NAME = "fillo-storage-write";
let fallbackWriteQueue: Promise<void> = Promise.resolve();

async function withStorageLocks<T>(names: StorageKeyName[], action: () => Promise<T>): Promise<T> {
  void names;

  if (globalThis.navigator?.locks?.request) {
    return globalThis.navigator.locks.request(STORAGE_WRITE_LOCK_NAME, async () => action());
  }

  const run = fallbackWriteQueue.then(action);
  fallbackWriteQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readProfiles(): Promise<Profile[]> {
  const result = await storageGet<StorageShape>([STORAGE_KEYS.profiles]);
  return Array.isArray(result.profiles) ? result.profiles : [];
}

async function readPresets(): Promise<FormPreset[]> {
  const result = await storageGet<StorageShape>([STORAGE_KEYS.presets]);
  return Array.isArray(result.presets) ? result.presets : [];
}

async function readSettings(): Promise<AppSettings> {
  const result = await storageGet<StorageShape>([STORAGE_KEYS.settings]);
  return { ...DEFAULT_SETTINGS, ...(result.settings ?? {}) };
}

async function readAll(): Promise<Required<StorageShape>> {
  const result = await storageGet<StorageShape>(Object.values(STORAGE_KEYS));
  return {
    profiles: Array.isArray(result.profiles) ? result.profiles : [],
    presets: Array.isArray(result.presets) ? result.presets : [],
    settings: { ...DEFAULT_SETTINGS, ...(result.settings ?? {}) },
  };
}

async function writeAll(data: Required<StorageShape>): Promise<void> {
  await storageSet(data);
}

export async function getProfiles(): Promise<Profile[]> {
  return readProfiles();
}

export async function saveProfile(profile: Profile): Promise<void> {
  await withStorageLocks(["profiles"], async () => {
    const profiles = await readProfiles();
    const existingIndex = profiles.findIndex((item) => item.id === profile.id);

    if (existingIndex >= 0) {
      profiles[existingIndex] = profile;
    } else {
      profiles.push(profile);
    }

    await storageSet({ [STORAGE_KEYS.profiles]: profiles });
  });
}

export async function deleteProfile(profileId: string): Promise<void> {
  await withStorageLocks(["profiles", "settings"], async () => {
    const [profiles, settings] = await Promise.all([readProfiles(), readSettings()]);
    const nextProfiles = profiles.filter((item) => item.id !== profileId);
    const nextState: StorageShape = {
      [STORAGE_KEYS.profiles]: nextProfiles,
    };

    if (settings.defaultProfileId === profileId) {
      nextState[STORAGE_KEYS.settings] = {
        ...settings,
        defaultProfileId: null,
      };
    }

    await storageSet(nextState);
  });
}

export async function getPresets(): Promise<FormPreset[]> {
  return readPresets();
}

export async function getPresetByFormKey(formKey: string): Promise<FormPreset | null> {
  return (await readPresets()).find((item) => item.formKey === formKey) ?? null;
}

export async function savePreset(preset: FormPreset): Promise<void> {
  await withStorageLocks(["presets"], async () => {
    const presets = await readPresets();
    const existingIndex = presets.findIndex((item) => item.id === preset.id || item.formKey === preset.formKey);

    if (existingIndex >= 0) {
      presets[existingIndex] = preset;
    } else {
      presets.push(preset);
    }

    await storageSet({ [STORAGE_KEYS.presets]: presets });
  });
}

export async function deletePreset(presetId: string): Promise<void> {
  await withStorageLocks(["presets"], async () => {
    const presets = await readPresets();
    await storageSet({
      [STORAGE_KEYS.presets]: presets.filter((item) => item.id !== presetId),
    });
  });
}

export async function getSettings(): Promise<AppSettings> {
  return readSettings();
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await withStorageLocks(["settings"], async () => {
    await storageSet({ [STORAGE_KEYS.settings]: settings });
  });
}

export async function clearAllData(): Promise<void> {
  await withStorageLocks(["profiles", "presets", "settings"], async () => {
    await writeAll({
      profiles: [],
      presets: [],
      settings: DEFAULT_SETTINGS,
    });
  });
}

export async function exportAppData(): Promise<ExportedAppData> {
  const data = await readAll();
  return {
    version: 1,
    exportedAt: Date.now(),
    profiles: data.profiles,
    presets: data.presets,
    settings: data.settings,
  };
}

export async function importAppData(payload: ImportedAppData): Promise<void> {
  if (!Array.isArray(payload.profiles) || !Array.isArray(payload.presets) || typeof payload.settings !== "object" || payload.settings === null) {
    throw new Error("Import payload must include profiles, presets, and settings.");
  }

  await withStorageLocks(["profiles", "presets", "settings"], async () => {
    await writeAll({
      profiles: payload.profiles,
      presets: payload.presets,
      settings: { ...DEFAULT_SETTINGS, ...payload.settings },
    });
  });
}

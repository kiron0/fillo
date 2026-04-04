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
  return (await readAll()).profiles;
}

export async function saveProfile(profile: Profile): Promise<void> {
  const data = await readAll();
  const existingIndex = data.profiles.findIndex((item) => item.id === profile.id);

  if (existingIndex >= 0) {
    data.profiles[existingIndex] = profile;
  } else {
    data.profiles.push(profile);
  }

  await writeAll(data);
}

export async function deleteProfile(profileId: string): Promise<void> {
  const data = await readAll();
  data.profiles = data.profiles.filter((item) => item.id !== profileId);
  if (data.settings.defaultProfileId === profileId) {
    data.settings = {
      ...data.settings,
      defaultProfileId: null,
    };
  }
  await writeAll(data);
}

export async function getPresets(): Promise<FormPreset[]> {
  return (await readAll()).presets;
}

export async function getPresetByFormKey(formKey: string): Promise<FormPreset | null> {
  return (await readAll()).presets.find((item) => item.formKey === formKey) ?? null;
}

export async function savePreset(preset: FormPreset): Promise<void> {
  const data = await readAll();
  const existingIndex = data.presets.findIndex((item) => item.id === preset.id || item.formKey === preset.formKey);

  if (existingIndex >= 0) {
    data.presets[existingIndex] = preset;
  } else {
    data.presets.push(preset);
  }

  await writeAll(data);
}

export async function deletePreset(presetId: string): Promise<void> {
  const data = await readAll();
  data.presets = data.presets.filter((item) => item.id !== presetId);
  await writeAll(data);
}

export async function getSettings(): Promise<AppSettings> {
  return (await readAll()).settings;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const data = await readAll();
  data.settings = settings;
  await writeAll(data);
}

export async function clearAllData(): Promise<void> {
  await writeAll({
    profiles: [],
    presets: [],
    settings: DEFAULT_SETTINGS,
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
  await writeAll({
    profiles: payload.profiles ?? [],
    presets: payload.presets ?? [],
    settings: { ...DEFAULT_SETTINGS, ...(payload.settings ?? {}) },
  });
}

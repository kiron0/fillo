import { storageGet, storageSet } from "./chrome-api";
import { DEFAULT_SETTINGS } from "./types";
import type { AppSettings, FormPreset, ImportedAppData, Profile } from "./types";

export const STORAGE_KEYS = {
  profiles: "profiles",
  presets: "presets",
  settings: "settings",
} as const;

type StorageShape = {
  [STORAGE_KEYS.profiles]?: Profile[];
  [STORAGE_KEYS.presets]?: FormPreset[];
  [STORAGE_KEYS.settings]?: AppSettings;
};

function normalizePreset(preset: FormPreset): FormPreset {
  const { mappings: rawMappings, unmappedFieldIds: rawUnmappedFieldIds, ...rest } = preset;
  const mappings = rawMappings ? { ...rawMappings } : undefined;
  const unmappedFieldIds = rawUnmappedFieldIds ? Array.from(new Set(rawUnmappedFieldIds)) : undefined;

  return {
    ...rest,
    ...(mappings && Object.keys(mappings).length ? { mappings } : {}),
    ...(unmappedFieldIds?.length ? { unmappedFieldIds } : {}),
  };
}

export async function readProfilesDirect(): Promise<Profile[]> {
  const result = await storageGet<StorageShape>([STORAGE_KEYS.profiles]);
  return Array.isArray(result.profiles) ? result.profiles : [];
}

export async function readPresetsDirect(): Promise<FormPreset[]> {
  const result = await storageGet<StorageShape>([STORAGE_KEYS.presets]);
  return Array.isArray(result.presets) ? result.presets.map(normalizePreset) : [];
}

export async function readSettingsDirect(): Promise<AppSettings> {
  const result = await storageGet<StorageShape>([STORAGE_KEYS.settings]);
  return { ...DEFAULT_SETTINGS, ...(result.settings ?? {}) };
}

export async function readAllDirect(): Promise<Required<StorageShape>> {
  const result = await storageGet<StorageShape>(Object.values(STORAGE_KEYS));
  return {
    profiles: Array.isArray(result.profiles) ? result.profiles : [],
    presets: Array.isArray(result.presets) ? result.presets.map(normalizePreset) : [],
    settings: { ...DEFAULT_SETTINGS, ...(result.settings ?? {}) },
  };
}

export async function writeAllDirect(data: Required<StorageShape>): Promise<void> {
  await storageSet(data);
}

export async function saveProfileDirect(profile: Profile): Promise<void> {
  const profiles = await readProfilesDirect();
  const existingIndex = profiles.findIndex((item) => item.id === profile.id);

  if (existingIndex >= 0) {
    profiles[existingIndex] = profile;
  } else {
    profiles.push(profile);
  }

  await storageSet({ [STORAGE_KEYS.profiles]: profiles });
}

export async function deleteProfileDirect(profileId: string): Promise<void> {
  const [profiles, settings] = await Promise.all([readProfilesDirect(), readSettingsDirect()]);
  const nextState: StorageShape = {
    [STORAGE_KEYS.profiles]: profiles.filter((item) => item.id !== profileId),
  };

  if (settings.defaultProfileId === profileId) {
    nextState[STORAGE_KEYS.settings] = {
      ...settings,
      defaultProfileId: null,
    };
  }

  await storageSet(nextState);
}

export async function savePresetDirect(preset: FormPreset): Promise<void> {
  const normalizedPreset = normalizePreset(preset);
  const presets = await readPresetsDirect();
  const existingIndex = presets.findIndex((item) => item.id === normalizedPreset.id || item.formKey === normalizedPreset.formKey);

  if (existingIndex >= 0) {
    presets[existingIndex] = normalizedPreset;
  } else {
    presets.push(normalizedPreset);
  }

  await storageSet({ [STORAGE_KEYS.presets]: presets });
}

export async function deletePresetDirect(presetId: string): Promise<void> {
  const presets = await readPresetsDirect();
  await storageSet({
    [STORAGE_KEYS.presets]: presets.filter((item) => item.id !== presetId),
  });
}

export async function saveSettingsDirect(settings: AppSettings): Promise<void> {
  await storageSet({ [STORAGE_KEYS.settings]: settings });
}

export async function clearAllDataDirect(): Promise<void> {
  await writeAllDirect({
    profiles: [],
    presets: [],
    settings: DEFAULT_SETTINGS,
  });
}

export async function importAppDataDirect(payload: ImportedAppData): Promise<void> {
  if (!Array.isArray(payload.profiles) || !Array.isArray(payload.presets) || typeof payload.settings !== "object" || payload.settings === null) {
    throw new Error("Import payload must include profiles, presets, and settings.");
  }

  await writeAllDirect({
    profiles: payload.profiles,
    presets: payload.presets.map(normalizePreset),
    settings: { ...DEFAULT_SETTINGS, ...payload.settings },
  });
}

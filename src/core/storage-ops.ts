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

const LEGACY_NO_MAPPING_SENTINEL = "__no_mapping__";

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProfileValue(value: unknown): boolean {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }

  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isDetectedField(value: unknown): boolean {
  if (!isStringRecord(value)) {
    return false;
  }

  const type = value.type;
  const allowedTypes = new Set(["text", "textarea", "radio", "checkbox", "dropdown", "scale", "date", "time", "grid"]);
  return (
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.normalizedLabel === "string" &&
    typeof value.required === "boolean" &&
    typeof type === "string" &&
    allowedTypes.has(type) &&
    (value.options === undefined || (Array.isArray(value.options) && value.options.every((option) => typeof option === "string"))) &&
    (value.otherOption === undefined || typeof value.otherOption === "string") &&
    (value.sectionTitle === undefined || typeof value.sectionTitle === "string") &&
    (value.helpText === undefined || typeof value.helpText === "string")
  );
}

function isChoiceWithOtherValue(value: unknown): boolean {
  if (!isStringRecord(value) || value.kind !== "choice_with_other" || typeof value.otherText !== "string") {
    return false;
  }

  return typeof value.selected === "string" || (Array.isArray(value.selected) && value.selected.every((item) => typeof item === "string"));
}

function isFieldValue(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    (Array.isArray(value) && value.every((item) => typeof item === "string")) ||
    isChoiceWithOtherValue(value)
  );
}

function isAppSettings(value: unknown): value is AppSettings {
  return (
    isStringRecord(value) &&
    (value.defaultProfileId === null || typeof value.defaultProfileId === "string" || value.defaultProfileId === undefined) &&
    typeof value.autoLoadMatchingProfile === "boolean" &&
    typeof value.confirmBeforeFill === "boolean" &&
    typeof value.showBackupSection === "boolean"
  );
}

function isProfile(value: unknown): value is Profile {
  if (!isStringRecord(value) || !isStringRecord(value.values)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number" &&
    Object.values(value.values).every(isProfileValue)
  );
}

function isFormPreset(value: unknown): value is FormPreset {
  if (!isStringRecord(value) || !isStringRecord(value.values)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.formKey === "string" &&
    typeof value.name === "string" &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number" &&
    Array.isArray(value.fields) &&
    value.fields.every(isDetectedField) &&
    Object.values(value.values).every(isFieldValue) &&
    (value.formTitle === undefined || typeof value.formTitle === "string") &&
    (value.formUrl === undefined || typeof value.formUrl === "string") &&
    (value.mappings === undefined ||
      (isStringRecord(value.mappings) && Object.values(value.mappings).every((item) => typeof item === "string"))) &&
    (value.unmappedFieldIds === undefined ||
      (Array.isArray(value.unmappedFieldIds) && value.unmappedFieldIds.every((item) => typeof item === "string"))) &&
    (value.mappingSchemaVersion === undefined || value.mappingSchemaVersion === 2)
  );
}

export function validateImportedAppData(payload: unknown): payload is Required<ImportedAppData> {
  return (
    isStringRecord(payload) &&
    payload.version === 1 &&
    Array.isArray(payload.profiles) &&
    payload.profiles.every(isProfile) &&
    Array.isArray(payload.presets) &&
    payload.presets.every(isFormPreset) &&
    isAppSettings(payload.settings)
  );
}

function normalizePreset(preset: FormPreset): FormPreset {
  const { mappings: rawMappings, unmappedFieldIds: rawUnmappedFieldIds, mappingSchemaVersion, ...rest } = preset;
  const mappings = rawMappings ? { ...rawMappings } : undefined;
  const unmappedFieldIds = new Set(rawUnmappedFieldIds ?? []);

  if (mappingSchemaVersion !== 2 && mappings) {
    for (const [fieldId, mappingKey] of Object.entries(mappings)) {
      if (mappingKey === LEGACY_NO_MAPPING_SENTINEL) {
        delete mappings[fieldId];
        unmappedFieldIds.add(fieldId);
      }
    }
  }

  const normalizedUnmappedFieldIds = Array.from(unmappedFieldIds);

  return {
    ...rest,
    ...(mappings && Object.keys(mappings).length ? { mappings } : {}),
    ...(normalizedUnmappedFieldIds.length ? { unmappedFieldIds: normalizedUnmappedFieldIds } : {}),
    ...(mappingSchemaVersion === 2 ? { mappingSchemaVersion } : {}),
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
  if (!isStringRecord(payload) || payload.version !== 1) {
    throw new Error("Import payload must be a version 1 backup.");
  }

  if (!validateImportedAppData(payload)) {
    throw new Error("Import payload must be a valid version 1 backup with well-formed profiles, presets, and settings.");
  }

  await writeAllDirect({
    profiles: payload.profiles,
    presets: payload.presets.map(normalizePreset),
    settings: { ...DEFAULT_SETTINGS, ...payload.settings },
  });
}

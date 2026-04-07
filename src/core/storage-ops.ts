import { storageGet, storageSet } from "./chrome-api";
import { isChoiceWithOtherValue, isValidDateValue, isValidTimeValue, looksLikePlaceholderOption, normalizeFieldValueForField } from "./field-value-normalization";
import { DEFAULT_EXPORT_SELECTION, DEFAULT_SETTINGS } from "./types";
import type { AppSettings, DetectedField, ExportSelection, FieldValue, FormHistoryEntry, FormPreset, GridValue, ImportedAppData, Profile } from "./types";

export const STORAGE_KEYS = {
  profiles: "profiles",
  presets: "presets",
  history: "history",
  settings: "settings",
} as const;

type StorageShape = {
  [STORAGE_KEYS.profiles]?: Profile[];
  [STORAGE_KEYS.presets]?: FormPreset[];
  [STORAGE_KEYS.history]?: FormHistoryEntry[];
  [STORAGE_KEYS.settings]?: AppSettings;
};

const MAX_HISTORY_ENTRIES = 25;

const LEGACY_NO_MAPPING_SENTINEL = "__no_mapping__";

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isProfileValue(value: unknown): boolean {
  if (typeof value === "string" || typeof value === "boolean") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPrimitiveFieldValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }

  return typeof value === "number" && Number.isFinite(value);
}

function isDetectedField(value: unknown): boolean {
  if (!isStringRecord(value)) {
    return false;
  }

  const type = value.type;
  const allowedTypes = new Set(["text", "textarea", "radio", "checkbox", "dropdown", "scale", "date", "time", "grid"]);
  const gridMetadataValid =
    type === "grid"
      ? Array.isArray(value.gridRows) &&
        value.gridRows.every((row) => typeof row === "string") &&
        (value.gridRowIds === undefined ||
          (Array.isArray(value.gridRowIds) &&
            value.gridRowIds.length === value.gridRows.length &&
            value.gridRowIds.every((rowId) => typeof rowId === "string"))) &&
        (value.gridMode === "radio" || value.gridMode === "checkbox")
      : value.gridRows === undefined && value.gridRowIds === undefined && value.gridMode === undefined;
  const scaleMetadataValid =
    type === "scale"
      ? (value.scaleLowLabel === undefined || typeof value.scaleLowLabel === "string") &&
        (value.scaleHighLabel === undefined || typeof value.scaleHighLabel === "string")
      : value.scaleLowLabel === undefined && value.scaleHighLabel === undefined;

  return (
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.normalizedLabel === "string" &&
    typeof value.required === "boolean" &&
    typeof type === "string" &&
    allowedTypes.has(type) &&
    (value.textSubtype === undefined ||
      value.textSubtype === "text" ||
      value.textSubtype === "email" ||
      value.textSubtype === "number" ||
      value.textSubtype === "tel" ||
      value.textSubtype === "url") &&
    (value.options === undefined || (Array.isArray(value.options) && value.options.every((option) => typeof option === "string"))) &&
    (value.otherOption === undefined || typeof value.otherOption === "string") &&
    gridMetadataValid &&
    scaleMetadataValid &&
    (value.sectionKey === undefined || typeof value.sectionKey === "string") &&
    (value.sectionTitle === undefined || typeof value.sectionTitle === "string") &&
    (value.helpText === undefined || typeof value.helpText === "string")
  );
}

function isFieldValue(value: unknown): boolean {
  return (
    isPrimitiveFieldValue(value) ||
    (Array.isArray(value) && value.every((item) => typeof item === "string")) ||
    isChoiceWithOtherValue(value) ||
    (isStringRecord(value) &&
      value.kind === "grid" &&
      isStringRecord(value.rows) &&
      Object.values(value.rows).every(
        (rowValue) =>
          typeof rowValue === "string" || (Array.isArray(rowValue) && rowValue.every((item) => typeof item === "string")),
      ))
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
    isFiniteNumber(value.createdAt) &&
    isFiniteNumber(value.updatedAt) &&
    Object.values(value.values).every(isProfileValue) &&
    (value.aliases === undefined ||
      (isStringRecord(value.aliases) &&
        Object.values(value.aliases).every(
          (aliasList) => Array.isArray(aliasList) && aliasList.every((alias) => typeof alias === "string"),
        )))
  );
}

function normalizeProfile(profile: Profile): Profile {
  const { aliases, ...rest } = profile;
  const liveValueKeys = new Set(Object.keys(profile.values));
  const normalizedAliases = aliases
    ? Object.fromEntries(
        Object.entries(aliases)
          .filter(([key]) => liveValueKeys.has(key))
          .map(([key, aliases]) => [key, Array.from(new Set(aliases.map((alias) => alias.trim()).filter(Boolean)))])
          .filter(([, aliases]) => aliases.length > 0),
      )
    : undefined;

  return {
    ...rest,
    ...(normalizedAliases && Object.keys(normalizedAliases).length > 0 ? { aliases: normalizedAliases } : {}),
  };
}

function isPresetSectionSnapshot(value: unknown): boolean {
  return (
    isStringRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    isFiniteNumber(value.updatedAt) &&
    Array.isArray(value.fieldIds) &&
    value.fieldIds.every((item) => typeof item === "string")
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
    isFiniteNumber(value.createdAt) &&
    isFiniteNumber(value.updatedAt) &&
    Array.isArray(value.fields) &&
    value.fields.every(isDetectedField) &&
    Object.values(value.values).every(isFieldValue) &&
    (value.formTitle === undefined || typeof value.formTitle === "string") &&
    (value.formUrl === undefined || typeof value.formUrl === "string") &&
    (value.mappings === undefined ||
      (isStringRecord(value.mappings) && Object.values(value.mappings).every((item) => typeof item === "string"))) &&
    (value.unmappedFieldIds === undefined ||
      (Array.isArray(value.unmappedFieldIds) && value.unmappedFieldIds.every((item) => typeof item === "string"))) &&
    (value.excludedFieldIds === undefined ||
      (Array.isArray(value.excludedFieldIds) && value.excludedFieldIds.every((item) => typeof item === "string"))) &&
    (value.sections === undefined || (Array.isArray(value.sections) && value.sections.every(isPresetSectionSnapshot))) &&
    (value.mappingSchemaVersion === undefined || value.mappingSchemaVersion === 2)
  );
}

function isFormHistoryEntry(value: unknown): value is FormHistoryEntry {
  return (
    isStringRecord(value) &&
    typeof value.id === "string" &&
    typeof value.formKey === "string" &&
    typeof value.formTitle === "string" &&
    (value.formUrl === undefined || typeof value.formUrl === "string") &&
    (value.lastUsedProfileId === null || typeof value.lastUsedProfileId === "string") &&
    (value.lastUsedProfileName === undefined || value.lastUsedProfileName === null || typeof value.lastUsedProfileName === "string") &&
    isFiniteNumber(value.lastFilledAt) &&
    isFiniteNumber(value.filledFieldCount) &&
    isFiniteNumber(value.skippedFieldCount)
  );
}

function isExportSelection(value: unknown): value is ExportSelection {
  return (
    isStringRecord(value) &&
    typeof value.profiles === "boolean" &&
    typeof value.presets === "boolean" &&
    typeof value.settings === "boolean" &&
    typeof value.history === "boolean"
  );
}

function isPartialExportSelection(value: unknown): value is Partial<ExportSelection> {
  return (
    isStringRecord(value) &&
    (value.profiles === undefined || typeof value.profiles === "boolean") &&
    (value.presets === undefined || typeof value.presets === "boolean") &&
    (value.settings === undefined || typeof value.settings === "boolean") &&
    (value.history === undefined || typeof value.history === "boolean")
  );
}

export function validateImportedAppData(payload: unknown): payload is ImportedAppData {
  return (
    isStringRecord(payload) &&
    payload.version === 1 &&
    (payload.profiles === undefined || (Array.isArray(payload.profiles) && payload.profiles.every(isProfile))) &&
    (payload.presets === undefined || (Array.isArray(payload.presets) && payload.presets.every(isFormPreset))) &&
    (payload.settings === undefined || isAppSettings(payload.settings)) &&
    (payload.history === undefined || (Array.isArray(payload.history) && payload.history.every(isFormHistoryEntry))) &&
    (payload.selection === undefined ||
      (isPartialExportSelection(payload.selection) && isExportSelection({ ...DEFAULT_EXPORT_SELECTION, ...payload.selection })))
  );
}

function normalizePreset(preset: FormPreset): FormPreset {
  const {
    mappings: rawMappings,
    unmappedFieldIds: rawUnmappedFieldIds,
    excludedFieldIds: rawExcludedFieldIds,
    sections: rawSections,
    mappingSchemaVersion,
    values: rawValues,
    ...rest
  } = preset;
  const activeFieldIds = rest.fields.length > 0 ? new Set(rest.fields.map((field) => field.id)) : null;
  const activeFieldsById = activeFieldIds ? new Map(rest.fields.map((field) => [field.id, field])) : null;
  const mappings = rawMappings ? { ...rawMappings } : undefined;
  const values = activeFieldIds
    ? Object.fromEntries(
        Object.entries(rawValues)
          .filter(([fieldId]) => activeFieldIds.has(fieldId))
          .map(([fieldId, value]) => {
            const field = activeFieldsById?.get(fieldId);
            const normalizedValue = field ? normalizePresetValueForField(field, value) : value;
            return normalizedValue === undefined ? null : ([fieldId, normalizedValue] as const);
          })
          .filter((entry): entry is readonly [string, FieldValue] => Boolean(entry)),
      )
    : rawValues;
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
  const normalizedMappings =
    mappings
      ? Object.fromEntries(Object.entries(mappings).filter(([fieldId]) => !activeFieldIds || activeFieldIds.has(fieldId)))
      : undefined;
  const mappedFieldIds = new Set(Object.keys(normalizedMappings ?? {}));
  const normalizedUnmappedFieldIdsInSchema = activeFieldIds
    ? normalizedUnmappedFieldIds.filter((fieldId) => activeFieldIds.has(fieldId) && !mappedFieldIds.has(fieldId))
    : normalizedUnmappedFieldIds.filter((fieldId) => !mappedFieldIds.has(fieldId));
  const normalizedExcludedFieldIds = activeFieldIds
    ? rawExcludedFieldIds?.filter((fieldId) => activeFieldIds.has(fieldId))
    : rawExcludedFieldIds;
  const normalizedSections = rawSections
    ? Array.from(
        rawSections
          .map((section) => ({
            ...section,
            fieldIds: activeFieldIds ? section.fieldIds.filter((fieldId) => activeFieldIds.has(fieldId)) : section.fieldIds,
          }))
          .filter((section) => section.fieldIds.length > 0)
          .reduce<Map<string, (typeof rawSections)[number]>>((map, section) => {
            const previous = map.get(section.id);
            if (!previous || section.updatedAt >= previous.updatedAt) {
              map.set(section.id, section);
            }
            return map;
          }, new Map())
          .values(),
      )
    : undefined;

  return {
    ...rest,
    values,
    ...(normalizedMappings && Object.keys(normalizedMappings).length ? { mappings: normalizedMappings } : {}),
    ...(normalizedUnmappedFieldIdsInSchema.length ? { unmappedFieldIds: normalizedUnmappedFieldIdsInSchema } : {}),
    ...(normalizedExcludedFieldIds?.length ? { excludedFieldIds: Array.from(new Set(normalizedExcludedFieldIds)) } : {}),
    ...(normalizedSections?.length
      ? { sections: normalizedSections.map((section) => ({ ...section, fieldIds: Array.from(new Set(section.fieldIds)) })) }
      : {}),
    ...(mappingSchemaVersion === 2 ? { mappingSchemaVersion } : {}),
  };
}

function normalizePresetValueForField(field: DetectedField, value: FieldValue): FieldValue | undefined {
  return normalizeFieldValueForField(field, value);
}

function normalizePresetCollection(presets: FormPreset[]): FormPreset[] {
  const normalizedPresets = presets
    .filter(isFormPreset)
    .map(normalizePreset)
    .map((preset, index) => ({ preset, index }))
    .sort(
      (left, right) =>
        left.preset.updatedAt - right.preset.updatedAt || left.index - right.index,
    );
  const seenIds = new Set<string>();
  const seenFormKeys = new Set<string>();
  const deduped: FormPreset[] = [];

  for (let index = normalizedPresets.length - 1; index >= 0; index -= 1) {
    const preset = normalizedPresets[index]!.preset;
    if (seenIds.has(preset.id) || seenFormKeys.has(preset.formKey)) {
      continue;
    }

    seenIds.add(preset.id);
    seenFormKeys.add(preset.formKey);
    deduped.push(preset);
  }

  return deduped.reverse();
}

function normalizeProfileCollection(profiles: Profile[]): Profile[] {
  const latestById = new Map<string, Profile>();

  for (const profile of profiles.filter(isProfile).map(normalizeProfile)) {
    const previous = latestById.get(profile.id);
    if (!previous || profile.updatedAt >= previous.updatedAt) {
      latestById.set(profile.id, profile);
    }
  }

  return Array.from(latestById.values());
}

function normalizeHistoryEntry(
  entry: FormHistoryEntry,
  profiles: Profile[],
): FormHistoryEntry {
  if (!entry.lastUsedProfileId) {
    return {
      ...entry,
      lastUsedProfileId: null,
      lastUsedProfileName: null,
    };
  }

  const profile = profiles.find((candidate) => candidate.id === entry.lastUsedProfileId);
  if (!profile) {
    return {
      ...entry,
      lastUsedProfileId: null,
      lastUsedProfileName: null,
    };
  }

  return {
    ...entry,
    lastUsedProfileId: profile.id,
    lastUsedProfileName: profile.name,
  };
}

function normalizeHistoryEntries(
  history: FormHistoryEntry[],
  profiles: Profile[] = [],
): FormHistoryEntry[] {
  const latestByFormKey = new Map<string, FormHistoryEntry>();

  for (const entry of history.filter(isFormHistoryEntry).map((item) => normalizeHistoryEntry(item, profiles))) {
    const previous = latestByFormKey.get(entry.formKey);
    if (!previous || entry.lastFilledAt >= previous.lastFilledAt) {
      latestByFormKey.set(entry.formKey, entry);
    }
  }

  return Array.from(latestByFormKey.values())
    .sort((left, right) => right.lastFilledAt - left.lastFilledAt)
    .slice(0, MAX_HISTORY_ENTRIES);
}

function normalizeSettings(settings: AppSettings | undefined, profiles: Profile[]): AppSettings {
  const nextSettings: AppSettings = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
  if (nextSettings.defaultProfileId && !profiles.some((profile) => profile.id === nextSettings.defaultProfileId)) {
    nextSettings.defaultProfileId = null;
  }

  return nextSettings;
}

export async function readProfilesDirect(): Promise<Profile[]> {
  const result = await storageGet<StorageShape>([STORAGE_KEYS.profiles]);
  return Array.isArray(result.profiles) ? normalizeProfileCollection(result.profiles) : [];
}

export async function readPresetsDirect(): Promise<FormPreset[]> {
  const result = await storageGet<StorageShape>([STORAGE_KEYS.presets]);
  return Array.isArray(result.presets) ? normalizePresetCollection(result.presets) : [];
}

export async function readHistoryDirect(): Promise<FormHistoryEntry[]> {
  const [profiles, result] = await Promise.all([
    readProfilesDirect(),
    storageGet<StorageShape>([STORAGE_KEYS.history]),
  ]);
  return Array.isArray(result.history)
    ? normalizeHistoryEntries(result.history, profiles)
    : [];
}

export async function readSettingsDirect(): Promise<AppSettings> {
  const [profiles, result] = await Promise.all([
    readProfilesDirect(),
    storageGet<StorageShape>([STORAGE_KEYS.settings]),
  ]);
  return normalizeSettings(isAppSettings(result.settings) ? result.settings : undefined, profiles);
}

export async function readAllDirect(): Promise<Required<StorageShape>> {
  const result = await storageGet<StorageShape>(Object.values(STORAGE_KEYS));
  const profiles = Array.isArray(result.profiles) ? normalizeProfileCollection(result.profiles) : [];
  return {
    profiles,
    presets: Array.isArray(result.presets) ? normalizePresetCollection(result.presets) : [],
    history: Array.isArray(result.history) ? normalizeHistoryEntries(result.history, profiles) : [],
    settings: normalizeSettings(isAppSettings(result.settings) ? result.settings : undefined, profiles),
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

  await storageSet({ [STORAGE_KEYS.profiles]: normalizeProfileCollection(profiles) });
}

export async function deleteProfileDirect(profileId: string): Promise<void> {
  const [profiles, settings, history] = await Promise.all([readProfilesDirect(), readSettingsDirect(), readHistoryDirect()]);
  const nextState: StorageShape = {
    [STORAGE_KEYS.profiles]: profiles.filter((item) => item.id !== profileId),
  };
  const nextHistory = history.map((entry) =>
    entry.lastUsedProfileId === profileId
      ? {
          ...entry,
          lastUsedProfileId: null,
          lastUsedProfileName: null,
        }
      : entry,
  );

  if (settings.defaultProfileId === profileId) {
    nextState[STORAGE_KEYS.settings] = {
      ...settings,
      defaultProfileId: null,
    };
  }

  if (
    nextHistory.some(
      (entry, index) =>
        entry.lastUsedProfileId !== history[index]?.lastUsedProfileId ||
        entry.lastUsedProfileName !== history[index]?.lastUsedProfileName,
    )
  ) {
    nextState[STORAGE_KEYS.history] = nextHistory;
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

  await storageSet({ [STORAGE_KEYS.presets]: normalizePresetCollection(presets) });
}

export async function deletePresetDirect(presetId: string): Promise<void> {
  const presets = await readPresetsDirect();
  await storageSet({
    [STORAGE_KEYS.presets]: presets.filter((item) => item.id !== presetId),
  });
}

export async function saveSettingsDirect(settings: AppSettings): Promise<void> {
  const profiles = await readProfilesDirect();
  await storageSet({
    [STORAGE_KEYS.settings]: normalizeSettings(settings, profiles),
  });
}

export async function saveHistoryEntryDirect(entry: FormHistoryEntry): Promise<void> {
  const profiles = await readProfilesDirect();
  const normalizedEntry = normalizeHistoryEntry(entry, profiles);
  const history = await readHistoryDirect();
  const filtered = history.filter((item) => item.formKey !== normalizedEntry.formKey);
  filtered.unshift(normalizedEntry);
  await storageSet({
    [STORAGE_KEYS.history]: normalizeHistoryEntries(filtered, profiles),
  });
}

export async function clearHistoryDirect(): Promise<void> {
  await storageSet({ [STORAGE_KEYS.history]: [] });
}

export async function clearAllDataDirect(): Promise<void> {
  await writeAllDirect({
    profiles: [],
    presets: [],
    history: [],
    settings: DEFAULT_SETTINGS,
  });
}

export async function importAppDataDirect(payload: ImportedAppData): Promise<void> {
  if (!isStringRecord(payload) || payload.version !== 1) {
    throw new Error("Import payload must be a version 1 backup.");
  }

  if (!validateImportedAppData(payload)) {
    throw new Error("Import payload must be a valid version 1 backup with well-formed profiles, presets, settings, and history.");
  }

  const currentState = await readAllDirect();
  const nextProfiles = Array.isArray(payload.profiles) ? normalizeProfileCollection(payload.profiles) : currentState.profiles;
  const nextPresets = Array.isArray(payload.presets) ? normalizePresetCollection(payload.presets) : currentState.presets;
  const nextHistory = Array.isArray(payload.history) ? normalizeHistoryEntries(payload.history, nextProfiles) : currentState.history;
  await writeAllDirect({
    profiles: nextProfiles,
    presets: nextPresets,
    history: nextHistory,
    settings: normalizeSettings(payload.settings ? { ...DEFAULT_SETTINGS, ...payload.settings } : currentState.settings, nextProfiles),
  });
}

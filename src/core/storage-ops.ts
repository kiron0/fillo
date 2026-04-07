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

function hasOwnKey(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}

function hasOwnString(value: Record<string, unknown>, key: string): boolean {
  return hasOwnKey(value, key) && typeof value[key] === "string";
}

function hasOwnFiniteNumber(value: Record<string, unknown>, key: string): boolean {
  return hasOwnKey(value, key) && isFiniteNumber(value[key]);
}

function optionalOwnString(value: Record<string, unknown>, key: string): boolean {
  return !(key in value) || (hasOwnKey(value, key) && (value[key] === undefined || typeof value[key] === "string"));
}

function optionalOwnStringArray(value: Record<string, unknown>, key: string): boolean {
  const fieldValue = value[key];
  return (
    !(key in value) ||
    (hasOwnKey(value, key) &&
      (fieldValue === undefined || (Array.isArray(fieldValue) && fieldValue.every((item) => typeof item === "string"))))
  );
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
  const optionBackedTypes = new Set(["radio", "checkbox", "dropdown", "scale", "grid"]);
  const gridRows = value.gridRows;
  const gridRowIds = value.gridRowIds;
  const optionsValid = optionBackedTypes.has(type as string)
    ? hasOwnKey(value, "options") &&
      Array.isArray(value.options) &&
      value.options.every((option) => typeof option === "string")
    : optionalOwnStringArray(value, "options");
  const gridMetadataValid =
    type === "grid"
      ? hasOwnKey(value, "gridRows") &&
        Array.isArray(gridRows) &&
        gridRows.every((row) => typeof row === "string") &&
        (!("gridRowIds" in value) ||
          (hasOwnKey(value, "gridRowIds") &&
            (gridRowIds === undefined ||
              (Array.isArray(gridRowIds) &&
                gridRowIds.length === gridRows.length &&
                gridRowIds.every((rowId) => typeof rowId === "string"))))) &&
        hasOwnKey(value, "gridMode") &&
        (value.gridMode === "radio" || value.gridMode === "checkbox")
      : !("gridRows" in value) && !("gridRowIds" in value) && !("gridMode" in value);
  const scaleMetadataValid =
    type === "scale"
      ? optionalOwnString(value, "scaleLowLabel") && optionalOwnString(value, "scaleHighLabel")
      : !("scaleLowLabel" in value) && !("scaleHighLabel" in value);

  return (
    hasOwnString(value, "id") &&
    hasOwnString(value, "label") &&
    hasOwnString(value, "normalizedLabel") &&
    hasOwnKey(value, "required") &&
    typeof value.required === "boolean" &&
    hasOwnKey(value, "type") &&
    typeof type === "string" &&
    allowedTypes.has(type) &&
    (!("textSubtype" in value) ||
      (hasOwnKey(value, "textSubtype") &&
        (value.textSubtype === "text" ||
          value.textSubtype === "email" ||
          value.textSubtype === "number" ||
          value.textSubtype === "tel" ||
          value.textSubtype === "url"))) &&
    optionsValid &&
    optionalOwnString(value, "otherOption") &&
    gridMetadataValid &&
    scaleMetadataValid &&
    optionalOwnString(value, "sectionKey") &&
    optionalOwnString(value, "sectionTitle") &&
    optionalOwnString(value, "helpText")
  );
}

export function isFieldValue(value: unknown): boolean {
  return (
    isPrimitiveFieldValue(value) ||
    (Array.isArray(value) && value.every((item) => typeof item === "string")) ||
    isChoiceWithOtherValue(value) ||
    (isStringRecord(value) &&
      Object.hasOwn(value, "kind") &&
      value.kind === "grid" &&
      Object.hasOwn(value, "rows") &&
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
    (!("defaultProfileId" in value) ||
      (hasOwnKey(value, "defaultProfileId") && (value.defaultProfileId === null || typeof value.defaultProfileId === "string"))) &&
    hasOwnKey(value, "autoLoadMatchingProfile") &&
    typeof value.autoLoadMatchingProfile === "boolean" &&
    hasOwnKey(value, "confirmBeforeFill") &&
    typeof value.confirmBeforeFill === "boolean" &&
    hasOwnKey(value, "showBackupSection") &&
    typeof value.showBackupSection === "boolean"
  );
}

function isProfile(value: unknown): value is Profile {
  if (!isStringRecord(value) || !hasOwnKey(value, "values") || !isStringRecord(value.values)) {
    return false;
  }

  return (
    hasOwnString(value, "id") &&
    hasOwnString(value, "name") &&
    hasOwnFiniteNumber(value, "createdAt") &&
    hasOwnFiniteNumber(value, "updatedAt") &&
    Object.values(value.values).every(isProfileValue) &&
    (!("aliases" in value) ||
      (hasOwnKey(value, "aliases") &&
        isStringRecord(value.aliases) &&
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
    hasOwnString(value, "id") &&
    hasOwnString(value, "title") &&
    hasOwnFiniteNumber(value, "updatedAt") &&
    hasOwnKey(value, "fieldIds") &&
    Array.isArray(value.fieldIds) &&
    value.fieldIds.every((item) => typeof item === "string")
  );
}

function isFormPreset(value: unknown): value is FormPreset {
  if (!isStringRecord(value) || !hasOwnKey(value, "values") || !isStringRecord(value.values)) {
    return false;
  }

  return (
    hasOwnString(value, "id") &&
    hasOwnString(value, "formKey") &&
    hasOwnString(value, "name") &&
    hasOwnFiniteNumber(value, "createdAt") &&
    hasOwnFiniteNumber(value, "updatedAt") &&
    hasOwnKey(value, "fields") &&
    Array.isArray(value.fields) &&
    value.fields.every(isDetectedField) &&
    Object.values(value.values).every(isFieldValue) &&
    optionalOwnString(value, "formTitle") &&
    optionalOwnString(value, "formUrl") &&
    (!("mappings" in value) ||
      (hasOwnKey(value, "mappings") && isStringRecord(value.mappings) && Object.values(value.mappings).every((item) => typeof item === "string"))) &&
    (!("unmappedFieldIds" in value) ||
      (hasOwnKey(value, "unmappedFieldIds") && Array.isArray(value.unmappedFieldIds) && value.unmappedFieldIds.every((item) => typeof item === "string"))) &&
    (!("excludedFieldIds" in value) ||
      (hasOwnKey(value, "excludedFieldIds") && Array.isArray(value.excludedFieldIds) && value.excludedFieldIds.every((item) => typeof item === "string"))) &&
    (!("sections" in value) || (hasOwnKey(value, "sections") && Array.isArray(value.sections) && value.sections.every(isPresetSectionSnapshot))) &&
    (!("mappingSchemaVersion" in value) || (hasOwnKey(value, "mappingSchemaVersion") && value.mappingSchemaVersion === 2))
  );
}

function isFormHistoryEntry(value: unknown): value is FormHistoryEntry {
  return (
    isStringRecord(value) &&
    hasOwnString(value, "id") &&
    hasOwnString(value, "formKey") &&
    hasOwnString(value, "formTitle") &&
    optionalOwnString(value, "formUrl") &&
    hasOwnKey(value, "lastUsedProfileId") &&
    (value.lastUsedProfileId === null || typeof value.lastUsedProfileId === "string") &&
    (!("lastUsedProfileName" in value) ||
      (hasOwnKey(value, "lastUsedProfileName") && (value.lastUsedProfileName === null || typeof value.lastUsedProfileName === "string"))) &&
    hasOwnFiniteNumber(value, "lastFilledAt") &&
    hasOwnFiniteNumber(value, "filledFieldCount") &&
    hasOwnFiniteNumber(value, "skippedFieldCount")
  );
}

function isExportSelection(value: unknown): value is ExportSelection {
  return (
    isStringRecord(value) &&
    hasOwnKey(value, "profiles") &&
    typeof value.profiles === "boolean" &&
    hasOwnKey(value, "presets") &&
    typeof value.presets === "boolean" &&
    hasOwnKey(value, "settings") &&
    typeof value.settings === "boolean" &&
    hasOwnKey(value, "history") &&
    typeof value.history === "boolean"
  );
}

function isPartialExportSelection(value: unknown): value is Partial<ExportSelection> {
  return (
    isStringRecord(value) &&
    (!("profiles" in value) || (hasOwnKey(value, "profiles") && typeof value.profiles === "boolean")) &&
    (!("presets" in value) || (hasOwnKey(value, "presets") && typeof value.presets === "boolean")) &&
    (!("settings" in value) || (hasOwnKey(value, "settings") && typeof value.settings === "boolean")) &&
    (!("history" in value) || (hasOwnKey(value, "history") && typeof value.history === "boolean"))
  );
}

export function validateImportedAppData(payload: unknown): payload is ImportedAppData {
  return (
    isStringRecord(payload) &&
    hasOwnKey(payload, "version") &&
    payload.version === 1 &&
    (!("profiles" in payload) || (hasOwnKey(payload, "profiles") && Array.isArray(payload.profiles) && payload.profiles.every(isProfile))) &&
    (!("presets" in payload) || (hasOwnKey(payload, "presets") && Array.isArray(payload.presets) && payload.presets.every(isFormPreset))) &&
    (!("settings" in payload) || (hasOwnKey(payload, "settings") && isAppSettings(payload.settings))) &&
    (!("history" in payload) || (hasOwnKey(payload, "history") && Array.isArray(payload.history) && payload.history.every(isFormHistoryEntry))) &&
    (!("selection" in payload) ||
      (hasOwnKey(payload, "selection") &&
        isPartialExportSelection(payload.selection) &&
        isExportSelection({ ...DEFAULT_EXPORT_SELECTION, ...payload.selection })))
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

import {
  hasChromeRuntime,
  runtimeOpenOptionsPage,
  runtimeSendMessage,
} from "../../core/chrome-api";
import {
  getSelectableOptions,
  isChoiceWithOtherValue,
  isGridValue,
  isValidDateValue,
  isValidTimeValue,
  looksLikePlaceholderOption,
  normalizeFieldValueForField,
} from "../../core/field-value-normalization";
import { rankProfilesForFields, suggestProfileKey } from "../../core/matching";
import { normalizeText, optionEquals } from "../../core/normalization";
import {
  deletePreset,
  getFormHistory,
  getPresetByFormKey,
  getProfiles,
  getSettings,
  saveHistoryEntry,
  savePreset,
} from "../../core/storage";
import type {
  ActiveFormContext,
  ActiveFormLookup,
  BackgroundRequest,
  DetectedField,
  FieldValue,
  FillResult,
  FormHistoryEntry,
  FormPreset,
  GridValue,
  MessageResponse,
  Profile,
} from "../../core/types";

type PopupState = {
  activeForm: ActiveFormContext | null;
  profiles: Profile[];
  history: FormHistoryEntry[];
  selectedProfileId: string | null;
  values: Record<string, FieldValue>;
  mappings: Record<string, string>;
  unmappedFieldIds: Set<string>;
  excludedFieldIds: Set<string>;
  autoBrokenMappings: Map<string, string>;
  dirtyFieldIds: Set<string>;
  clearedFieldIds: Set<string>;
  suppressedMappingFieldIds: Set<string>;
  preset: FormPreset | null;
  skippedFillFieldIds: string[];
  autoLoadMatchingProfile: boolean;
  confirmBeforeFill: boolean;
};

const state: PopupState = {
  activeForm: null,
  profiles: [],
  history: [],
  selectedProfileId: null,
  values: {},
  mappings: {},
  unmappedFieldIds: new Set<string>(),
  excludedFieldIds: new Set<string>(),
  autoBrokenMappings: new Map<string, string>(),
  dirtyFieldIds: new Set<string>(),
  clearedFieldIds: new Set<string>(),
  suppressedMappingFieldIds: new Set<string>(),
  preset: null,
  skippedFillFieldIds: [],
  autoLoadMatchingProfile: true,
  confirmBeforeFill: true,
};

const AUTOSAVE_DELAY_MS = 500;
const MAX_HISTORY_ENTRIES = 25;

const formTitle = document.querySelector<HTMLHeadingElement>("#form-title")!;
const formMeta = document.querySelector<HTMLParagraphElement>("#form-meta")!;
const statusCard = document.querySelector<HTMLDivElement>("#status-card")!;
const errorCard = document.querySelector<HTMLDivElement>("#error-card")!;
const errorTitle = document.querySelector<HTMLHeadingElement>("#error-title")!;
const errorMessage =
  document.querySelector<HTMLParagraphElement>("#error-message")!;
const profileControls =
  document.querySelector<HTMLDivElement>("#profile-controls")!;
const fieldsContainer = document.querySelector<HTMLDivElement>("#fields")!;
const profileSelect =
  document.querySelector<HTMLSelectElement>("#profile-select")!;
const profileSelectBlock =
  profileSelect.closest<HTMLElement>(".select-block") ??
  profileSelect.parentElement;
const profileCard =
  profileSelect.closest<HTMLElement>(".controls-card") ?? profileSelectBlock;
const resetPresetButton =
  document.querySelector<HTMLButtonElement>("#reset-preset")!;
const fillFormButton = document.querySelector<HTMLButtonElement>("#fill-form")!;
const clearValuesButton =
  document.querySelector<HTMLButtonElement>("#clear-values")!;
const openOptionsButton =
  document.querySelector<HTMLButtonElement>("#open-options")!;

let autosaveTimer: number | null = null;
let presetSaveInFlight: Promise<void> | null = null;
let presetCommitVersion = 0;
let pendingPresetId: string | null = null;

function setStatus(
  message: string,
  mode: "idle" | "error" | "success" = "idle",
): void {
  if (!message) {
    statusCard.textContent = "";
    statusCard.classList.add("hidden");
    delete statusCard.dataset.state;
    return;
  }

  statusCard.textContent = message;
  statusCard.dataset.state = mode;
  statusCard.classList.remove("hidden");
}

function getSelectedProfile(): Profile | null {
  return (
    state.profiles.find((profile) => profile.id === state.selectedProfileId) ??
    null
  );
}

function normalizeSelectedProfileId(profileId: string | null): string | null {
  if (!profileId) {
    return null;
  }

  return state.profiles.some((profile) => profile.id === profileId)
    ? profileId
    : null;
}

function getRankedProfileSuggestions(): ReturnType<
  typeof rankProfilesForFields
> {
  return state.activeForm
    ? rankProfilesForFields(
        state.activeForm.fields,
        state.profiles,
        state.history,
        state.activeForm.formKey,
      )
    : [];
}

function getSuggestedProfileId(): string | null {
  return getRankedProfileSuggestions()[0]?.profile.id ?? null;
}

function normalizePopupHistory(
  entries: FormHistoryEntry[],
): FormHistoryEntry[] {
  const latestByFormKey = new Map<string, FormHistoryEntry>();

  for (const entry of entries) {
    const previous = latestByFormKey.get(entry.formKey);
    if (!previous || entry.lastFilledAt >= previous.lastFilledAt) {
      latestByFormKey.set(entry.formKey, entry);
    }
  }

  return Array.from(latestByFormKey.values())
    .sort((left, right) => right.lastFilledAt - left.lastFilledAt)
    .slice(0, MAX_HISTORY_ENTRIES);
}

function setInvalidPageState(title: string, message: string): void {
  state.activeForm = null;
  formTitle.textContent = "Google Form Required";
  formMeta.textContent = "The current tab is not a supported Google Form.";
  errorTitle.textContent = title;
  errorMessage.textContent = message;
  errorCard.classList.remove("hidden");
  statusCard.classList.add("hidden");
  profileControls.classList.add("hidden");
  fieldsContainer.classList.add("hidden");
}

function setReadyState(): void {
  errorCard.classList.add("hidden");
}

async function sendBackgroundMessage<T>(
  message: BackgroundRequest,
): Promise<T> {
  const response = (await runtimeSendMessage<MessageResponse<T>>(
    message,
  )) as MessageResponse<T>;
  if (!response?.ok) {
    throw new Error(response?.error ?? "Background request failed");
  }

  if (response.data === undefined) {
    throw new Error("Background response was missing data");
  }

  return response.data as T;
}

function isFillResult(value: unknown): value is FillResult {
  if (!isStringRecord(value)) {
    return false;
  }

  return (
    hasOwnKey(value, "filledFieldIds") &&
    isStringArray(value.filledFieldIds) &&
    hasOwnKey(value, "skippedFieldIds") &&
    isStringArray(value.skippedFieldIds)
  );
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnKey(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}

function isDenseArrayOf(value: unknown, isItem: (item: unknown) => boolean): value is unknown[] {
  if (!Array.isArray(value)) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index) || !isItem(value[index])) {
      return false;
    }
  }

  return true;
}

function hasOwnString(value: Record<string, unknown>, key: string): boolean {
  return hasOwnKey(value, key) && typeof value[key] === "string";
}

function hasOwnBoolean(value: Record<string, unknown>, key: string): boolean {
  return hasOwnKey(value, key) && typeof value[key] === "boolean";
}

function isStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index) || typeof value[index] !== "string") {
      return false;
    }
  }

  return true;
}

function hasOwnOptionalString(value: Record<string, unknown>, key: string): boolean {
  return !(key in value) || (hasOwnKey(value, key) && (value[key] === undefined || typeof value[key] === "string"));
}

function hasOwnOptionalStringArray(value: Record<string, unknown>, key: string): boolean {
  const fieldValue = value[key];
  return (
    !(key in value) ||
    (hasOwnKey(value, key) && (fieldValue === undefined || isStringArray(fieldValue)))
  );
}

function isDetectedField(value: unknown): value is DetectedField {
  const allowedTypes = new Set(["text", "textarea", "radio", "checkbox", "dropdown", "scale", "date", "time", "grid"]);
  if (!isStringRecord(value)) {
    return false;
  }

  const field = value;
  const optionBackedTypes = new Set(["radio", "checkbox", "dropdown", "scale", "grid"]);
  const otherOptionTypes = new Set(["radio", "checkbox"]);
  const gridRows = field.gridRows;
  const gridRowIds = field.gridRowIds;
  const optionsValid = optionBackedTypes.has(field.type as string)
    ? hasOwnKey(field, "options") &&
      isStringArray(field.options)
    : hasOwnOptionalStringArray(field, "options");
  const textSubtypeValid =
    field.type === "text"
      ? !("textSubtype" in field) ||
        (hasOwnKey(field, "textSubtype") &&
          (field.textSubtype === undefined ||
            field.textSubtype === "text" ||
            field.textSubtype === "email" ||
            field.textSubtype === "number" ||
            field.textSubtype === "tel" ||
            field.textSubtype === "url"))
      : !("textSubtype" in field) || (hasOwnKey(field, "textSubtype") && field.textSubtype === undefined);
  const otherOptionValid =
    otherOptionTypes.has(field.type as string)
      ? hasOwnOptionalString(field, "otherOption") &&
        (typeof field.otherOption !== "string" || (isStringArray(field.options) && field.options.includes(field.otherOption)))
      : !("otherOption" in field) || (hasOwnKey(field, "otherOption") && field.otherOption === undefined);
  const gridMetadataValid =
    field.type === "grid"
      ? hasOwnKey(field, "gridRows") &&
        isStringArray(gridRows) &&
        (!("gridRowIds" in field) ||
          (hasOwnKey(field, "gridRowIds") &&
            (gridRowIds === undefined ||
              (isStringArray(gridRowIds) &&
                gridRowIds.length === gridRows.length)))) &&
        hasOwnKey(field, "gridMode") &&
        (field.gridMode === "radio" || field.gridMode === "checkbox")
      : !("gridRows" in field) && !("gridRowIds" in field) && !("gridMode" in field);
  const scaleMetadataValid =
    field.type === "scale"
      ? hasOwnOptionalString(field, "scaleLowLabel") && hasOwnOptionalString(field, "scaleHighLabel")
      : !("scaleLowLabel" in field) && !("scaleHighLabel" in field);

  return (
    hasOwnString(field, "id") &&
    hasOwnString(field, "label") &&
    hasOwnString(field, "normalizedLabel") &&
    hasOwnString(field, "type") &&
    allowedTypes.has(field.type as string) &&
    hasOwnBoolean(field, "required") &&
    textSubtypeValid &&
    optionsValid &&
    otherOptionValid &&
    gridMetadataValid &&
    scaleMetadataValid &&
    hasOwnOptionalString(field, "sectionKey") &&
    hasOwnOptionalString(field, "sectionTitle") &&
    hasOwnOptionalString(field, "helpText")
  );
}

function isActiveFormContext(value: unknown): value is ActiveFormContext {
  if (!isStringRecord(value)) {
    return false;
  }

  return (
    hasOwnString(value, "title") &&
    hasOwnString(value, "url") &&
    hasOwnString(value, "formKey") &&
    hasOwnKey(value, "fields") &&
    isDenseArrayOf(value.fields, isDetectedField)
  );
}

function isActiveFormLookup(value: unknown): value is ActiveFormLookup {
  if (!isStringRecord(value) || !hasOwnKey(value, "status")) {
    return false;
  }

  const lookup = value;
  const validStatus =
    lookup.status === "ready" ||
    lookup.status === "unsupported_only" ||
    lookup.status === "invalid_url" ||
    lookup.status === "no_active_tab";

  if (!validStatus || !hasOwnOptionalString(lookup, "pageUrl")) {
    return false;
  }

  if (lookup.status === "ready" || lookup.status === "unsupported_only") {
    return hasOwnKey(lookup, "context") && isActiveFormContext(lookup.context);
  }

  return !("context" in lookup);
}

function renderProfileSelect(): void {
  profileSelectBlock?.classList.toggle("hidden", state.profiles.length === 0);
  profileCard?.classList.toggle("hidden", state.profiles.length === 0);
  profileSelect.replaceChildren();

  if (state.profiles.length === 0) {
    return;
  }

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "No profile";
  profileSelect.append(emptyOption);

  const suggestions = new Map(
    getRankedProfileSuggestions().map((entry, index) => [
      entry.profile.id,
      index,
    ]),
  );

  for (const profile of state.profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    const suggestionIndex = suggestions.get(profile.id);
    option.textContent =
      suggestionIndex === 0 ? `${profile.name} • suggested` : profile.name;
    if (profile.id === state.selectedProfileId) {
      option.selected = true;
    }
    profileSelect.append(option);
  }
}

function syncFieldMappingControl(fieldId: string): void {
  const fieldCard = Array.from(
    fieldsContainer.querySelectorAll<HTMLElement>("[data-field-id]"),
  ).find((candidate) => candidate.dataset.fieldId === fieldId);
  const mappingSelect = fieldCard?.querySelector<HTMLSelectElement>(
    ".mapping-row select",
  );
  if (!mappingSelect) {
    return;
  }

  mappingSelect.value = state.unmappedFieldIds.has(fieldId)
    ? ""
    : (state.mappings[fieldId] ?? "");
}

function updateFieldValue(
  fieldId: string,
  value: FieldValue,
  markDirty = true,
): void {
  setStatus("");
  let shouldMarkDirty = markDirty;
  let mappingStateChanged = false;

  if (markDirty) {
    const field = state.activeForm?.fields.find(
      (candidate) => candidate.id === fieldId,
    );
    const profile = getSelectedProfile();
    const currentMapping = state.mappings[fieldId];
    const mappedValue =
      field && profile && currentMapping
        ? coerceFieldValueForField(field, profile.values[currentMapping])
        : undefined;

    if (currentMapping && mappedValue !== undefined) {
      if (fieldValuesEqual(value, mappedValue)) {
        shouldMarkDirty = false;
      } else {
        delete state.mappings[fieldId];
        state.unmappedFieldIds.add(fieldId);
        state.suppressedMappingFieldIds.add(fieldId);
        state.autoBrokenMappings.set(fieldId, currentMapping);
        mappingStateChanged = true;
      }
    } else if (field && profile && state.autoBrokenMappings.has(fieldId)) {
      const brokenMapping = state.autoBrokenMappings.get(fieldId);
      const preferredMapping =
        (brokenMapping &&
        coerceFieldValueForField(field, profile.values[brokenMapping]) !==
          undefined
          ? brokenMapping
          : undefined) ??
        (state.preset?.mappings?.[fieldId] &&
        coerceFieldValueForField(
          field,
          profile.values[state.preset.mappings[fieldId]],
        ) !== undefined
          ? state.preset.mappings[fieldId]
          : undefined) ??
        suggestProfileKey(field, profile);

      if (preferredMapping) {
        const preferredMappedValue = coerceFieldValueForField(
          field,
          profile.values[preferredMapping],
        );
        if (
          preferredMappedValue !== undefined &&
          fieldValuesEqual(value, preferredMappedValue)
        ) {
          state.mappings[fieldId] = preferredMapping;
          state.unmappedFieldIds.delete(fieldId);
          state.suppressedMappingFieldIds.delete(fieldId);
          state.autoBrokenMappings.delete(fieldId);
          shouldMarkDirty = false;
          mappingStateChanged = true;
        }
      }
    }
  }

  state.values[fieldId] = value;
  state.clearedFieldIds.delete(fieldId);
  state.skippedFillFieldIds = state.skippedFillFieldIds.filter(
    (candidate) => candidate !== fieldId,
  );
  if (shouldMarkDirty) {
    state.dirtyFieldIds.add(fieldId);
  } else {
    clearDirtyField(fieldId);
  }
  schedulePresetSave();

  if (mappingStateChanged) {
    syncFieldMappingControl(fieldId);
  }

  refreshRenderedFieldReview(fieldId);
}

function fieldValuesEqual(
  left: FieldValue | undefined,
  right: FieldValue | undefined,
): boolean {
  if (
    left === undefined ||
    left === null ||
    right === undefined ||
    right === null
  ) {
    return (left ?? null) === (right ?? null);
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return compareOptionArrays(left.map(String), right.map(String));
  }

  if (isChoiceWithOtherValue(left) && isChoiceWithOtherValue(right)) {
    if (Array.isArray(left.selected) && Array.isArray(right.selected)) {
      return (
        compareOptionArrays(
          left.selected.map(String),
          right.selected.map(String),
        ) && left.otherText === right.otherText
      );
    }

    if (
      typeof left.selected === "string" &&
      typeof right.selected === "string"
    ) {
      return (
        optionEquals(left.selected, right.selected) &&
        left.otherText === right.otherText
      );
    }

    return false;
  }

  if (isGridValue(left) && isGridValue(right)) {
    return compareGridRows(left.rows, right.rows);
  }

  return JSON.stringify(left) === JSON.stringify(right);
}

function clearDirtyField(fieldId: string): void {
  state.dirtyFieldIds.delete(fieldId);
}

function getFieldTextSubtype(
  field: DetectedField,
): "text" | "email" | "number" | "tel" | "url" {
  if (field.textSubtype) {
    return field.textSubtype;
  }

  const normalizedLabel = field.normalizedLabel;
  if (normalizedLabel.includes("email")) {
    return "email";
  }
  if (
    normalizedLabel.includes("url") ||
    normalizedLabel.includes("website") ||
    normalizedLabel.includes("web site") ||
    normalizedLabel.includes("portfolio") ||
    normalizedLabel.includes("link")
  ) {
    return "url";
  }
  if (
    normalizedLabel.includes("phone") ||
    normalizedLabel.includes("mobile") ||
    normalizedLabel.includes("contact")
  ) {
    return "tel";
  }
  if (
    normalizedLabel.includes("number") ||
    normalizedLabel.includes("count") ||
    normalizedLabel.includes("age")
  ) {
    return "number";
  }

  return "text";
}

function getFieldSectionIdentifier(field: DetectedField): string {
  return field.sectionTitle
    ? normalizeText(field.sectionTitle).replace(/\s+/g, "_")
    : "form_overview";
}

function getNamedSectionCount(fields: DetectedField[]): number {
  return new Set(
    fields
      .map((field) => field.sectionTitle?.trim())
      .filter((title): title is string => Boolean(title))
      .map((title) => normalizeText(title)),
  ).size;
}

function getFieldValidationMessage(
  field: DetectedField,
  value: FieldValue | undefined,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    field.type === "date" &&
    typeof value === "string" &&
    !isValidDateValue(value)
  ) {
    return "Use YYYY-MM-DD for this date field.";
  }

  if (
    field.type === "time" &&
    typeof value === "string" &&
    !isValidTimeValue(value)
  ) {
    return "Use 24-hour HH:MM for this time field.";
  }

  if (field.type === "text" || field.type === "textarea") {
    if (typeof value !== "string" && typeof value !== "number") {
      return "This value does not match the expected input format.";
    }

    const textValue = String(value).trim();
    if (!textValue) {
      return null;
    }

    switch (getFieldTextSubtype(field)) {
      case "email":
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(textValue)
          ? null
          : "Enter a valid email address.";
      case "number":
        return Number.isFinite(Number(textValue))
          ? null
          : "Enter a valid number.";
      case "tel":
        return /^[+\d][\d\s().-]{5,}$/.test(textValue)
          ? null
          : "Enter a valid phone number.";
      case "url":
        try {
          new URL(textValue);
          return null;
        } catch {
          return "Enter a valid URL.";
        }
      default:
        return null;
    }
  }

  return null;
}

function getFieldReviewState(field: DetectedField): {
  include: boolean;
  hasValue: boolean;
  requiredEmpty: boolean;
  invalidMessage: string | null;
  cleared: boolean;
} {
  const value = coerceFieldValueForField(field, state.values[field.id]);
  const include = !state.excludedFieldIds.has(field.id);
  const hasValue = value === null ? false : hasPersistableFieldValue(value);
  const requiredEmpty = include && field.required && !hasValue;
  const invalidMessage = include
    ? getFieldValidationMessage(field, value)
    : null;
  const cleared =
    state.clearedFieldIds.has(field.id) ||
    (field.type === "dropdown" && state.values[field.id] === null);

  return { include, hasValue, requiredEmpty, invalidMessage, cleared };
}

function getCardReviewState(
  review: ReturnType<typeof getFieldReviewState>,
): "excluded" | "warning" | "ready" {
  if (!review.include) {
    return "excluded";
  }

  return review.requiredEmpty || review.invalidMessage ? "warning" : "ready";
}

function buildFieldMeta(
  field: DetectedField,
  review: ReturnType<typeof getFieldReviewState>,
): HTMLDivElement | null {
  const meta = document.createElement("div");
  meta.className = "field-meta";

  if (field.required) {
    const requiredBadge = document.createElement("span");
    requiredBadge.className = "badge required";
    requiredBadge.textContent = "Required";
    meta.append(requiredBadge);
  }

  if (!review.include) {
    const excludedBadge = document.createElement("span");
    excludedBadge.className = "badge muted";
    excludedBadge.textContent = "Excluded";
    meta.append(excludedBadge);
  }

  if (review.requiredEmpty) {
    const reviewBadge = document.createElement("span");
    reviewBadge.className = "badge warning";
    reviewBadge.textContent = "Needs value";
    meta.append(reviewBadge);
  }

  if (review.invalidMessage) {
    const invalidBadge = document.createElement("span");
    invalidBadge.className = "badge warning";
    invalidBadge.textContent = review.invalidMessage;
    meta.append(invalidBadge);
  }

  if (state.skippedFillFieldIds.includes(field.id)) {
    const skippedBadge = document.createElement("span");
    skippedBadge.className = "badge warning";
    skippedBadge.textContent = "Skipped on last fill";
    meta.append(skippedBadge);
  }

  if (state.mappings[field.id]) {
    const mappedBadge = document.createElement("span");
    mappedBadge.className = "badge";
    mappedBadge.textContent = `Mapped: ${state.mappings[field.id]}`;
    meta.append(mappedBadge);
  }

  return meta.childElementCount > 0 ? meta : null;
}

function refreshRenderedFieldReview(fieldId: string): void {
  const field = state.activeForm?.fields.find(
    (candidate) => candidate.id === fieldId,
  );
  const card = Array.from(
    fieldsContainer.querySelectorAll<HTMLElement>("[data-field-id]"),
  ).find((candidate) => candidate.dataset.fieldId === fieldId);
  const header = card?.querySelector<HTMLElement>(".field-head");

  if (!field || !card || !header) {
    return;
  }

  const review = getFieldReviewState(field);
  card.dataset.reviewState = getCardReviewState(review);

  const nextMeta = buildFieldMeta(field, review);
  const existingMeta = header.querySelector<HTMLElement>(".field-meta");

  if (nextMeta) {
    if (existingMeta) {
      existingMeta.replaceWith(nextMeta);
    } else {
      header.append(nextMeta);
    }
    return;
  }

  existingMeta?.remove();
}

function hasPersistableFieldValue(value: FieldValue | undefined): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (isChoiceWithOtherValue(value)) {
    if (Array.isArray(value.selected)) {
      return value.selected.length > 0;
    }

    return String(value.selected).trim().length > 0;
  }

  if (isGridValue(value)) {
    return Object.values(value.rows).some((rowValue) =>
      Array.isArray(rowValue)
        ? rowValue.length > 0
        : String(rowValue).trim().length > 0,
    );
  }

  return true;
}

function compareOptionArrays(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const normalizedLeft = left.map((item) => normalizeText(item)).sort();
  const normalizedRight = right.map((item) => normalizeText(item)).sort();
  return normalizedLeft.every(
    (value, index) => value === normalizedRight[index],
  );
}

function compareGridRows(
  left: Record<string, string | string[]>,
  right: Record<string, string | string[]>,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (!compareOptionArrays(leftKeys, rightKeys)) {
    return false;
  }

  return leftKeys.every((key) => {
    const leftValue = left[key];
    const rightValue = right[key];

    if (Array.isArray(leftValue) && Array.isArray(rightValue)) {
      return compareOptionArrays(leftValue.map(String), rightValue.map(String));
    }

    return (
      !Array.isArray(leftValue) &&
      !Array.isArray(rightValue) &&
      optionEquals(String(leftValue), String(rightValue))
    );
  });
}

function clonePreset(preset: FormPreset | null): FormPreset | null {
  return preset ? structuredClone(preset) : null;
}

function hasStoredFieldValue(
  values: Record<string, FieldValue>,
  fieldId: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(values, fieldId);
}

function restorePresetFieldValue(field: DetectedField, fieldId: string): void {
  const presetValue = coerceFieldValueForField(
    field,
    state.preset?.values[fieldId],
  );
  if (presetValue !== undefined) {
    state.values[fieldId] = presetValue;
  } else {
    delete state.values[fieldId];
  }
}

function findMatchingOption(
  field: DetectedField,
  value: string,
): string | undefined {
  return getSelectableOptions(field).find((option) =>
    optionEquals(option, value),
  );
}

function getScaleIconKind(field: DetectedField): "star" | "heart" | "thumb" {
  const normalizedLabel = normalizeText(field.label);
  if (normalizedLabel.includes("heart") || normalizedLabel.includes("love")) {
    return "heart";
  }

  if (normalizedLabel.includes("thumb") || normalizedLabel.includes("like")) {
    return "thumb";
  }

  return "star";
}

function createScaleIcon(kind: "star" | "heart" | "thumb"): HTMLElement {
  const icon = document.createElement("span");
  icon.className = `rating-item-icon rating-item-icon-${kind}`;

  switch (kind) {
    case "heart":
      icon.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.4 4.9 13.7a4.9 4.9 0 0 1 6.9-6.9l.2.2.2-.2a4.9 4.9 0 0 1 6.9 6.9L12 20.4Z"/></svg>';
      break;
    case "thumb":
      icon.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 10V5.8c0-1.3.4-2.5 1.2-3.5L12 1l1.8 1.5c.4.3.6.8.6 1.3V10h4.1c1.2 0 2.1 1 2.1 2.1 0 .2 0 .4-.1.6l-1.7 6.6a2.2 2.2 0 0 1-2.1 1.7H10m0-11H6.5c-.8 0-1.5.7-1.5 1.5v8c0 .8.7 1.5 1.5 1.5H10"/></svg>';
      break;
    default:
      icon.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.8 2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8 2.5-5Z"/></svg>';
      break;
  }

  return icon;
}

function syncScaleSelectionState(
  wrapper: HTMLElement,
  selectedValue: string,
): void {
  const items = Array.from(
    wrapper.querySelectorAll<HTMLElement>(".rating-item"),
  );
  const selectedIndex = items.findIndex(
    (item) => item.dataset.optionValue === selectedValue,
  );

  items.forEach((item, index) => {
    item.classList.toggle(
      "is-active",
      selectedIndex >= 0 && index <= selectedIndex,
    );
    item.classList.toggle("is-selected", index === selectedIndex);
  });
}

function isLinearScaleField(field: DetectedField): boolean {
  return Boolean(field.scaleLowLabel || field.scaleHighLabel);
}

function isPopupEditableField(field: DetectedField): boolean {
  switch (field.type) {
    case "text":
    case "textarea":
    case "radio":
    case "checkbox":
    case "dropdown":
    case "scale":
    case "date":
    case "time":
    case "grid":
      return true;
    default:
      return false;
  }
}

function coerceFieldValueForField(
  field: DetectedField,
  value: FieldValue | Profile["values"][string] | undefined,
): FieldValue | undefined {
  return normalizeFieldValueForField(field, value);
}

function buildFillValues(): Record<string, FieldValue> {
  if (!state.activeForm) {
    return {};
  }

  return Object.fromEntries(
    state.activeForm.fields
      .filter((field) => !state.excludedFieldIds.has(field.id))
      .map((field) => {
        if (
          field.type === "dropdown" &&
          hasStoredFieldValue(state.values, field.id) &&
          state.values[field.id] === null
        ) {
          return [field.id, null] as const;
        }

        return [
          field.id,
          coerceFieldValueForField(field, state.values[field.id]),
        ] as const;
      })
      .filter(
        ([fieldId, value]) =>
          value === null ||
          hasPersistableFieldValue(value) ||
          (state.activeForm?.fields.find((field) => field.id === fieldId)
            ?.type === "dropdown" &&
            value === null),
      ),
  ) as Record<string, FieldValue>;
}

function updateFieldMapping(fieldId: string, value: string): void {
  setStatus("");
  const field = state.activeForm?.fields.find(
    (candidate) => candidate.id === fieldId,
  );
  const profile = getSelectedProfile();
  const previousMapping = state.mappings[fieldId];
  state.skippedFillFieldIds = state.skippedFillFieldIds.filter(
    (candidate) => candidate !== fieldId,
  );

  if (!value) {
    delete state.mappings[fieldId];
    state.unmappedFieldIds.add(fieldId);
    state.suppressedMappingFieldIds.add(fieldId);
    state.autoBrokenMappings.delete(fieldId);
    state.clearedFieldIds.delete(fieldId);

    if (field && profile && previousMapping) {
      const previousMappedValue = coerceFieldValueForField(
        field,
        profile.values[previousMapping],
      );
      if (fieldValuesEqual(state.values[fieldId], previousMappedValue)) {
        restorePresetFieldValue(field, fieldId);
        clearDirtyField(fieldId);
      }
    }

    schedulePresetSave();
    return;
  }

  if (!field || !profile) {
    state.mappings[fieldId] = value;
    state.unmappedFieldIds.delete(fieldId);
    state.suppressedMappingFieldIds.delete(fieldId);
    state.autoBrokenMappings.delete(fieldId);
    state.clearedFieldIds.delete(fieldId);
    schedulePresetSave();
    return;
  }

  const mappedValue = coerceFieldValueForField(field, profile.values[value]);
  if (mappedValue === undefined) {
    return;
  }

  state.mappings[fieldId] = value;
  state.unmappedFieldIds.delete(fieldId);
  state.suppressedMappingFieldIds.delete(fieldId);
  state.autoBrokenMappings.delete(fieldId);
  state.clearedFieldIds.delete(fieldId);
  state.values[fieldId] = mappedValue;
  clearDirtyField(fieldId);

  schedulePresetSave();
}

function buildPresetPayload(): FormPreset | null {
  if (!state.activeForm) {
    return null;
  }

  const activeFieldIds = new Set(
    state.activeForm.fields.map((field) => field.id),
  );
  const presetValues = state.preset?.values ?? {};
  const presetMappings = state.preset?.mappings ?? {};
  const presetUnmappedFieldIds = new Set(state.preset?.unmappedFieldIds ?? []);
  const values = Object.fromEntries(
    state.activeForm.fields
      .map((field) => {
        const currentValue = coerceFieldValueForField(
          field,
          state.values[field.id],
        );
        if (hasPersistableFieldValue(currentValue)) {
          return [field.id, currentValue] as const;
        }

        if (state.clearedFieldIds.has(field.id)) {
          const presetValue = coerceFieldValueForField(
            field,
            presetValues[field.id],
          );
          if (hasPersistableFieldValue(presetValue)) {
            return [field.id, presetValue] as const;
          }
        }

        return null;
      })
      .filter((entry): entry is readonly [string, FieldValue] =>
        Boolean(entry),
      ),
  ) as Record<string, FieldValue>;

  const persistedMappings: Record<string, string> = {};
  const persistedUnmappedFieldIds = new Set<string>();

  for (const field of state.activeForm.fields) {
    const currentMapping = state.mappings[field.id];
    const preservedPresetMapping = state.clearedFieldIds.has(field.id)
      ? presetMappings[field.id]
      : undefined;
    const mappingValue = currentMapping ?? preservedPresetMapping;
    if (mappingValue) {
      persistedMappings[field.id] = mappingValue;
    }

    const hasCurrentExplicitNoMapping = state.unmappedFieldIds.has(field.id);
    const hasPreservedPresetNoMapping =
      state.clearedFieldIds.has(field.id) &&
      presetUnmappedFieldIds.has(field.id);
    if (hasCurrentExplicitNoMapping || hasPreservedPresetNoMapping) {
      persistedUnmappedFieldIds.add(field.id);
    }
  }

  const hasValues = Object.keys(values).length > 0;
  const normalizedUnmappedFieldIds = Array.from(
    persistedUnmappedFieldIds,
  ).filter((fieldId) => activeFieldIds.has(fieldId));
  const normalizedExcludedFieldIds = Array.from(state.excludedFieldIds).filter(
    (fieldId) => activeFieldIds.has(fieldId),
  );
  const sections = Array.from(
    state.activeForm.fields
      .reduce<Map<string, { id: string; title: string; fieldIds: string[] }>>(
        (map, field) => {
          if (!field.sectionTitle?.trim()) {
            return map;
          }

          const key = getFieldSectionIdentifier(field);
          const title = field.sectionTitle;
          const current = map.get(key) ?? { id: key, title, fieldIds: [] };
          current.fieldIds.push(field.id);
          map.set(key, current);
          return map;
        },
        new Map(),
      )
      .values(),
  ).map((section) => ({
    ...section,
    updatedAt: Date.now(),
  }));

  const hasMappings =
    Object.keys(persistedMappings).length > 0 ||
    normalizedUnmappedFieldIds.length > 0 ||
    normalizedExcludedFieldIds.length > 0;
  if (!hasValues && !hasMappings) {
    return null;
  }

  const now = Date.now();
  return {
    id: state.preset?.id ?? pendingPresetId ?? crypto.randomUUID(),
    formKey: state.activeForm.formKey,
    name: state.preset?.name ?? state.activeForm.title,
    formTitle: state.activeForm.title,
    formUrl: state.activeForm.url,
    fields: structuredClone(state.activeForm.fields),
    values: structuredClone(values),
    mappings: persistedMappings,
    ...(normalizedUnmappedFieldIds.length
      ? { unmappedFieldIds: normalizedUnmappedFieldIds }
      : {}),
    ...(normalizedExcludedFieldIds.length
      ? { excludedFieldIds: normalizedExcludedFieldIds }
      : {}),
    ...(sections.length ? { sections } : {}),
    mappingSchemaVersion: 2,
    createdAt: state.preset?.createdAt ?? now,
    updatedAt: now,
  };
}

async function persistPreset(showStatus = false): Promise<void> {
  const commitVersion = presetCommitVersion;
  const activeForm = state.activeForm;
  const preset = buildPresetPayload();
  pendingPresetId = preset?.id ?? state.preset?.id ?? pendingPresetId;
  if (!preset) {
    const presetIdToDelete = state.preset?.id ?? pendingPresetId;
    if (presetIdToDelete) {
      await deletePreset(presetIdToDelete);
      if (commitVersion === presetCommitVersion) {
        state.preset = null;
        if (pendingPresetId === presetIdToDelete) {
          pendingPresetId = null;
        }
        renderPresetActions();
      }
    }
    return;
  }

  await savePreset(preset);
  if (commitVersion !== presetCommitVersion) {
    return;
  }

  state.preset = activeForm
    ? (await getPresetByFormKey(activeForm.formKey)) ?? preset
    : preset;
  pendingPresetId = state.preset?.id ?? pendingPresetId;
  renderPresetActions();
  if (showStatus) {
    setStatus("Preset saved locally for this form.", "success");
  }
}

function runPresetPersist(showStatus = false): Promise<void> {
  const savePromise = persistPreset(showStatus).finally(() => {
    if (presetSaveInFlight === savePromise) {
      presetSaveInFlight = null;
    }
  });
  presetSaveInFlight = savePromise;
  return savePromise;
}

async function flushPendingPresetSave(): Promise<void> {
  const hadScheduledSave = autosaveTimer !== null;
  let lastError: unknown = null;
  if (hadScheduledSave) {
    if (autosaveTimer !== null) {
      window.clearTimeout(autosaveTimer);
    }
    autosaveTimer = null;
  }

  if (presetSaveInFlight) {
    try {
      await presetSaveInFlight;
    } catch (error) {
      lastError = error;
    }
  }

  if (hadScheduledSave) {
    try {
      await runPresetPersist();
      lastError = null;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }
}

function renderPresetActions(): void {
  resetPresetButton.disabled = !state.preset;
}

function getFieldDisplayLabel(fieldId: string): string {
  return (
    state.activeForm?.fields.find((field) => field.id === fieldId)?.label ??
    fieldId
  );
}

function getFieldType(fieldId: string): DetectedField["type"] | null {
  return (
    state.activeForm?.fields.find((field) => field.id === fieldId)?.type ?? null
  );
}

function schedulePresetSave(): void {
  if (!state.activeForm) {
    return;
  }

  presetCommitVersion += 1;

  if (autosaveTimer !== null) {
    window.clearTimeout(autosaveTimer);
  }

  autosaveTimer = window.setTimeout(() => {
    autosaveTimer = null;
    void runPresetPersist().catch((error) => {
      setStatus(
        error instanceof Error ? error.message : "Unable to save preset",
        "error",
      );
    });
  }, AUTOSAVE_DELAY_MS);
}

function createValueControl(
  field: DetectedField,
  value: FieldValue,
): HTMLElement {
  if (!isPopupEditableField(field)) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = "";
    input.disabled = true;
    input.placeholder = "This field type is not supported yet";
    return input;
  }

  switch (field.type) {
    case "textarea": {
      const textarea = document.createElement("textarea");
      textarea.rows = 3;
      textarea.placeholder = "Your answer";
      textarea.value =
        typeof value === "string" || typeof value === "number"
          ? String(value)
          : "";
      textarea.addEventListener("input", () =>
        updateFieldValue(field.id, textarea.value),
      );
      return textarea;
    }
    case "radio": {
      const wrapper = document.createElement("div");
      wrapper.className = "choice-with-other checkbox-list";

      const selectedValue =
        isChoiceWithOtherValue(value) && typeof value.selected === "string"
          ? value.selected
          : String(value ?? "");
      const otherText = isChoiceWithOtherValue(value) ? value.otherText : "";
      const radioName = `popup-radio-${field.id}`;
      const hadOtherSelected = field.otherOption
        ? selectedValue === field.otherOption
        : false;

      for (const optionValue of field.options ?? []) {
        const label = document.createElement("label");
        label.className = "checkbox-item";

        const input = document.createElement("input");
        input.type = "radio";
        input.name = radioName;
        input.value = optionValue;
        input.checked = selectedValue === optionValue;
        input.addEventListener("change", () => {
          if (!input.checked) {
            return;
          }

          if (field.otherOption && optionValue === field.otherOption) {
            updateFieldValue(field.id, {
              kind: "choice_with_other",
              selected: optionValue,
              otherText,
            });
            renderFields();
            return;
          }

          updateFieldValue(field.id, optionValue);
          if (hadOtherSelected) {
            renderFields();
          }
        });

        const text = document.createElement("span");
        text.textContent = optionValue;
        label.append(input, text);
        wrapper.append(label);
      }

      if (field.otherOption && selectedValue === field.otherOption) {
        const otherInput = document.createElement("input");
        otherInput.type = "text";
        otherInput.className = "other-text-input";
        otherInput.placeholder = "Your answer";
        otherInput.value = otherText;
        otherInput.addEventListener("input", () =>
          updateFieldValue(field.id, {
            kind: "choice_with_other",
            selected: field.otherOption as string,
            otherText: otherInput.value,
          }),
        );
        wrapper.append(otherInput);
      }

      return wrapper;
    }
    case "scale": {
      if (isLinearScaleField(field)) {
        const wrapper = document.createElement("div");
        wrapper.className = "linear-scale";
        const radioName = `popup-scale-${field.id}`;
        const options = field.options ?? [];

        wrapper.style.setProperty(
          "--linear-columns",
          String(Math.min(options.length || 1, 5)),
        );

        const selectedValue =
          isChoiceWithOtherValue(value) && typeof value.selected === "string"
            ? value.selected
            : String(value ?? "");

        for (const optionValue of options) {
          const label = document.createElement("label");
          label.className = "linear-scale-item";

          const input = document.createElement("input");
          input.type = "radio";
          input.name = radioName;
          input.value = optionValue;
          input.checked = selectedValue === optionValue;
          input.addEventListener("change", () => {
            if (input.checked) {
              updateFieldValue(field.id, optionValue);
            }
          });

          const valueLabel = document.createElement("span");
          valueLabel.className = "linear-scale-value";
          valueLabel.textContent = optionValue;

          const indicator = document.createElement("span");
          indicator.className = "linear-scale-indicator";

          label.append(input, valueLabel, indicator);
          wrapper.append(label);
        }
        return wrapper;
      }

      const wrapper = document.createElement("div");
      wrapper.className = "rating-scale";

      const selectedValue =
        isChoiceWithOtherValue(value) && typeof value.selected === "string"
          ? value.selected
          : String(value ?? "");
      const iconKind = getScaleIconKind(field);
      const radioName = `popup-scale-${field.id}`;
      const options = field.options ?? [];

      wrapper.style.setProperty(
        "--rating-columns",
        String(Math.min(options.length || 1, 5)),
      );

      for (const optionValue of options) {
        const label = document.createElement("label");
        label.className = "rating-item";
        label.dataset.optionValue = optionValue;

        const input = document.createElement("input");
        input.type = "radio";
        input.name = radioName;
        input.value = optionValue;
        input.checked = selectedValue === optionValue;
        input.addEventListener("change", () => {
          if (input.checked) {
            updateFieldValue(field.id, optionValue);
            syncScaleSelectionState(wrapper, optionValue);
          }
        });

        const number = document.createElement("span");
        number.className = "rating-item-value";
        number.textContent = optionValue;

        label.append(input, number, createScaleIcon(iconKind));
        wrapper.append(label);
      }

      syncScaleSelectionState(wrapper, selectedValue);

      return wrapper;
    }
    case "dropdown": {
      const select = document.createElement("select");
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "Select an option";
      select.append(empty);

      const selectedValue = typeof value === "string" ? value : "";
      const dropdownOptions = getSelectableOptions(field);
      if (
        selectedValue &&
        !looksLikePlaceholderOption(selectedValue) &&
        !dropdownOptions.some((option) => optionEquals(option, selectedValue))
      ) {
        dropdownOptions.unshift(selectedValue);
      }

      for (const optionValue of dropdownOptions) {
        const option = document.createElement("option");
        option.value = optionValue;
        option.textContent = optionValue;
        option.selected = selectedValue === optionValue;
        select.append(option);
      }

      select.addEventListener("change", () => {
        const selectedValue = select.value;
        updateFieldValue(
          field.id,
          selectedValue && !looksLikePlaceholderOption(selectedValue)
            ? selectedValue
            : null,
        );
      });
      return select;
    }
    case "date":
    case "time": {
      const input = document.createElement("input");
      input.type = field.type;
      input.value = typeof value === "string" ? value : "";
      input.addEventListener("input", () =>
        updateFieldValue(field.id, input.value || null),
      );
      return input;
    }
    case "checkbox": {
      const wrapper = document.createElement("div");
      wrapper.className = "checkbox-list";
      const selectedValues =
        isChoiceWithOtherValue(value) && Array.isArray(value.selected)
          ? value.selected
          : Array.isArray(value)
            ? value.map(String)
            : [];
      const selected = new Set(selectedValues);
      const getCurrentSelectedValues = (): string[] => {
        const current = state.values[field.id];
        if (
          isChoiceWithOtherValue(current) &&
          Array.isArray(current.selected)
        ) {
          return current.selected.map(String);
        }

        if (Array.isArray(current)) {
          return current.map(String);
        }

        return selectedValues;
      };
      const getCurrentOtherText = (): string => {
        const current = state.values[field.id];
        return isChoiceWithOtherValue(current) ? current.otherText : "";
      };

      for (const optionValue of field.options ?? []) {
        const label = document.createElement("label");
        label.className = "checkbox-item";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selected.has(optionValue);
        checkbox.addEventListener("change", () => {
          const next = new Set(getCurrentSelectedValues());
          if (checkbox.checked) {
            next.add(optionValue);
          } else {
            next.delete(optionValue);
          }

          const nextValues = Array.from(next);
          if (field.otherOption && next.has(field.otherOption)) {
            updateFieldValue(field.id, {
              kind: "choice_with_other",
              selected: nextValues,
              otherText: getCurrentOtherText(),
            });
            renderFields();
            return;
          }

          updateFieldValue(field.id, nextValues);
          if (field.otherOption === optionValue) {
            renderFields();
          }
        });

        const text = document.createElement("span");
        text.textContent = optionValue;
        label.append(checkbox, text);
        wrapper.append(label);
      }

      if (field.otherOption && selected.has(field.otherOption)) {
        const otherInput = document.createElement("input");
        otherInput.type = "text";
        otherInput.className = "other-text-input";
        otherInput.placeholder = "Your answer";
        otherInput.value = getCurrentOtherText();
        otherInput.addEventListener("input", () =>
          updateFieldValue(field.id, {
            kind: "choice_with_other",
            selected: getCurrentSelectedValues(),
            otherText: otherInput.value,
          }),
        );
        wrapper.append(otherInput);
      }

      return wrapper;
    }
    case "grid": {
      const wrapper = document.createElement("div");
      wrapper.className = "grid-group-list";

      const columns = field.options ?? [];
      const rows = field.gridRows ?? [];
      const mode = field.gridMode ?? "radio";
      const currentRows = isGridValue(value) ? value.rows : {};

      for (const [rowIndex, rowLabel] of rows.entries()) {
        const rowKey = field.gridRowIds?.[rowIndex] ?? rowLabel;
        const selectedValue = currentRows[rowKey] ?? currentRows[rowLabel];
        const selectedValues = Array.isArray(selectedValue)
          ? selectedValue.map(String)
          : [];

        const group = document.createElement("section");
        group.className = "grid-group";
        group.dataset.gridRow = rowKey;
        group.setAttribute("role", "group");

        const groupLabel = document.createElement("p");
        groupLabel.className = "grid-group-label";
        groupLabel.textContent = rowLabel;
        const groupLabelId = `popup-grid-${field.id}-row-label-${rowIndex}`;
        groupLabel.id = groupLabelId;
        group.setAttribute("aria-labelledby", groupLabelId);
        group.append(groupLabel);

        const optionsList = document.createElement("div");
        optionsList.className = "grid-option-list";

        for (const column of columns) {
          const optionLabel = document.createElement("label");
          optionLabel.className = "checkbox-item grid-stacked-option";

          const input = document.createElement("input");
          input.type = mode === "checkbox" ? "checkbox" : "radio";
          if (mode === "radio") {
            input.name = `popup-grid-${field.id}-row-${rowIndex}`;
          }
          input.value = column;
          input.checked =
            mode === "checkbox"
              ? selectedValues.some((value) => optionEquals(value, column))
              : optionEquals(String(selectedValue ?? ""), column);
          input.addEventListener("change", () => {
            const current: GridValue = isGridValue(state.values[field.id])
              ? structuredClone(state.values[field.id] as GridValue)
              : { kind: "grid", rows: {} };
            const nextRows = current.rows;

            if (mode === "checkbox") {
              const existingRowValue = nextRows[rowKey] ?? nextRows[rowLabel];
              const nextSelected = Array.isArray(existingRowValue)
                ? [...existingRowValue]
                : [];
              const existingIndex = nextSelected.findIndex((value) =>
                optionEquals(value, column),
              );
              if (input.checked && existingIndex === -1) {
                nextSelected.push(column);
              }
              if (!input.checked && existingIndex !== -1) {
                nextSelected.splice(existingIndex, 1);
              }
              if (nextSelected.length > 0) {
                nextRows[rowKey] = nextSelected;
                if (rowKey !== rowLabel) {
                  delete nextRows[rowLabel];
                }
              } else {
                delete nextRows[rowKey];
                delete nextRows[rowLabel];
              }
            } else if (input.checked) {
              nextRows[rowKey] = column;
              if (rowKey !== rowLabel) {
                delete nextRows[rowLabel];
              }
            }

            updateFieldValue(field.id, { kind: "grid", rows: nextRows });
          });

          const text = document.createElement("span");
          text.className = "grid-stacked-option-label";
          text.textContent = column;

          optionLabel.append(input, text);
          optionsList.append(optionLabel);
        }

        group.append(optionsList);
        wrapper.append(group);
      }

      return wrapper;
    }
    default: {
      const input = document.createElement("input");
      input.type = "text";
      input.value =
        typeof value === "string" || typeof value === "number"
          ? String(value)
          : "";
      input.placeholder = "Your answer";
      input.addEventListener("input", () =>
        updateFieldValue(field.id, input.value),
      );
      return input;
    }
  }
}

function renderFields(): void {
  const previousScrollTop = fieldsContainer.scrollTop;
  fieldsContainer.replaceChildren();

  if (!state.activeForm) {
    return;
  }

  const profile = getSelectedProfile();

  const sections = state.activeForm.fields.reduce<Map<string, DetectedField[]>>(
    (map, field) => {
      const key = getFieldSectionIdentifier(field);
      const existing = map.get(key) ?? [];
      existing.push(field);
      map.set(key, existing);
      return map;
    },
    new Map(),
  );

  for (const [sectionKey, fields] of sections) {
    const section = document.createElement("section");
    section.className = "field-section";
    section.dataset.sectionKey = sectionKey;

    const sectionHeading = fields[0]?.sectionTitle?.trim();
    const shouldRenderSectionHeading =
      Boolean(sectionHeading) &&
      normalizeText(sectionHeading ?? "") !==
        normalizeText(state.activeForm.title) &&
      !(sectionKey === "form_overview");

    if (shouldRenderSectionHeading && sectionHeading) {
      const sectionHead = document.createElement("div");
      sectionHead.className = "field-section-head";
      const sectionTitle = document.createElement("p");
      sectionTitle.className = "field-section-title";
      sectionTitle.textContent = sectionHeading;
      const sectionMeta = document.createElement("p");
      sectionMeta.className = "field-section-meta";
      sectionMeta.textContent = `${fields.length} field${fields.length === 1 ? "" : "s"}`;
      sectionHead.append(sectionTitle, sectionMeta);
      section.append(sectionHead);
    }

    for (const field of fields) {
      const review = getFieldReviewState(field);
      const card = document.createElement("article");
      card.className = "field-card";
      card.dataset.fieldId = field.id;
      card.dataset.reviewState = getCardReviewState(review);

      const header = document.createElement("div");
      header.className = "field-head";

      const topLine = document.createElement("div");
      topLine.className = "field-topline";

      const label = document.createElement("p");
      label.className = "field-label";

      const labelText = document.createElement("span");
      labelText.textContent = field.label;
      label.append(labelText);

      if (field.required) {
        const requiredMark = document.createElement("span");
        requiredMark.className = "field-required-mark";
        requiredMark.textContent = " *";
        label.append(requiredMark);
      }

      const includeButton = document.createElement("button");
      includeButton.type = "button";
      includeButton.className = "field-toggle";
      includeButton.textContent = review.include ? "Included" : "Excluded";
      includeButton.setAttribute(
        "aria-pressed",
        review.include ? "true" : "false",
      );
      includeButton.addEventListener("click", () => {
        setStatus("");
        if (!review.include) {
          state.excludedFieldIds.delete(field.id);
        } else {
          state.excludedFieldIds.add(field.id);
        }
        state.skippedFillFieldIds = state.skippedFillFieldIds.filter(
          (fieldId) => fieldId !== field.id,
        );
        schedulePresetSave();
        renderFields();
      });

      topLine.append(label, includeButton);
      header.append(topLine);

      if (field.helpText) {
        const description = document.createElement("p");
        description.className = "field-description";
        description.textContent = field.helpText;
        header.append(description);
      }

      const meta = buildFieldMeta(field, review);
      if (meta) {
        header.append(meta);
      }

      const body = document.createElement("div");
      body.className = "field-body";
      body.append(createValueControl(field, state.values[field.id] ?? null));

      if (profile && isPopupEditableField(field)) {
        const compatibleProfileKeys = Object.keys(profile.values).filter(
          (key) =>
            coerceFieldValueForField(field, profile.values[key]) !== undefined,
        );
        if (compatibleProfileKeys.length > 0 || state.mappings[field.id]) {
          const mappingRow = document.createElement("label");
          mappingRow.className = "mapping-row";

          const mappingLabel = document.createElement("span");
          mappingLabel.textContent = "Mapped profile key";

          const mappingSelect = document.createElement("select");
          const noneOption = document.createElement("option");
          noneOption.value = "";
          noneOption.textContent = "No mapping";
          noneOption.selected =
            state.unmappedFieldIds.has(field.id) || !state.mappings[field.id];
          mappingSelect.append(noneOption);

          for (const key of compatibleProfileKeys) {
            const option = document.createElement("option");
            option.value = key;
            option.textContent = key;
            option.selected = state.mappings[field.id] === key;
            mappingSelect.append(option);
          }

          mappingSelect.addEventListener("change", () => {
            updateFieldMapping(field.id, mappingSelect.value);
            renderFields();
          });

          mappingRow.append(mappingLabel, mappingSelect);
          body.append(mappingRow);
        }
      }

      card.append(header, body);
      section.append(card);
    }

    fieldsContainer.append(section);
  }

  fieldsContainer.scrollTop = previousScrollTop;
}

function applyProfile(profileId: string | null, autosave = true): void {
  if (state.activeForm) {
    setStatus("");
  }
  const previousProfile = getSelectedProfile();
  const previousValues = { ...state.values };
  const previousMappings = { ...state.mappings };
  const previousUnmappedFieldIds = new Set(state.unmappedFieldIds);
  state.selectedProfileId = normalizeSelectedProfileId(profileId);
  const profile = getSelectedProfile();

  if (!state.activeForm) {
    return;
  }

  const presetValues = state.preset?.values ?? {};
  const presetMappings = state.preset?.mappings ?? {};
  const presetUnmappedFieldIds = new Set(state.preset?.unmappedFieldIds ?? []);
  const nextValues: Record<string, FieldValue> = {};
  const nextMappings: Record<string, string> = {};
  const nextUnmappedFieldIds = new Set<string>();
  const nextAutoBrokenMappings = new Map<string, string>();

  for (const field of state.activeForm.fields) {
    if (state.clearedFieldIds.has(field.id)) {
      continue;
    }

    const currentMapping = previousMappings[field.id];
    const presetMapping = presetMappings[field.id];
    const isMappingSuppressed = state.suppressedMappingFieldIds.has(field.id);
    const hasExplicitNoMapping =
      previousUnmappedFieldIds.has(field.id) ||
      presetUnmappedFieldIds.has(field.id);
    const suggestedMapping = profile
      ? suggestProfileKey(field, profile)
      : undefined;
    const mappingKey =
      isMappingSuppressed || hasExplicitNoMapping
        ? undefined
        : ((!profile ? (currentMapping ?? presetMapping) : undefined) ??
          (profile &&
          currentMapping &&
          coerceFieldValueForField(field, profile.values[currentMapping]) !==
            undefined
            ? currentMapping
            : undefined) ??
          (profile &&
          presetMapping &&
          coerceFieldValueForField(field, profile.values[presetMapping]) !==
            undefined
            ? presetMapping
            : undefined) ??
          (profile &&
          suggestedMapping &&
          coerceFieldValueForField(field, profile.values[suggestedMapping]) !==
            undefined
            ? suggestedMapping
            : undefined));

    if (mappingKey) {
      nextMappings[field.id] = mappingKey;
    } else if (hasExplicitNoMapping) {
      nextUnmappedFieldIds.add(field.id);
    }

    const brokenMapping = state.autoBrokenMappings.get(field.id);
    if (brokenMapping && brokenMapping !== mappingKey) {
      nextAutoBrokenMappings.set(field.id, brokenMapping);
    }

    if (
      state.dirtyFieldIds.has(field.id) &&
      hasStoredFieldValue(previousValues, field.id)
    ) {
      nextValues[field.id] = previousValues[field.id];
      continue;
    }

    const mappedValue = mappingKey
      ? coerceFieldValueForField(field, profile?.values[mappingKey])
      : undefined;
    if (mappedValue !== undefined) {
      nextValues[field.id] = mappedValue;
      continue;
    }

    const presetValue = coerceFieldValueForField(field, presetValues[field.id]);
    if (presetValue !== undefined) {
      nextValues[field.id] = presetValue;
      continue;
    }

    const previousMappedValue = currentMapping
      ? coerceFieldValueForField(field, previousProfile?.values[currentMapping])
      : undefined;
    if (
      hasStoredFieldValue(previousValues, field.id) &&
      currentMapping &&
      previousMappedValue !== undefined &&
      !fieldValuesEqual(previousValues[field.id], previousMappedValue)
    ) {
      nextValues[field.id] = previousValues[field.id];
      state.dirtyFieldIds.add(field.id);
    }
  }

  state.values = nextValues;
  state.mappings = nextMappings;
  state.unmappedFieldIds = nextUnmappedFieldIds;
  state.autoBrokenMappings = nextAutoBrokenMappings;
  state.skippedFillFieldIds = [];
  renderProfileSelect();
  renderPresetActions();
  renderFields();
  if (autosave) {
    schedulePresetSave();
  }
}

async function loadPopup(): Promise<void> {
  const [profiles, settings, history, lookup] = await Promise.all([
    getProfiles(),
    getSettings(),
    getFormHistory(),
    sendBackgroundMessage<ActiveFormLookup>({
      type: "GET_ACTIVE_FORM_CONTEXT",
    }),
  ]);

  if (!isActiveFormLookup(lookup)) {
    throw new Error("Background active form response was malformed");
  }

  state.profiles = profiles;
  state.history = history;
  state.autoLoadMatchingProfile = settings.autoLoadMatchingProfile;
  state.confirmBeforeFill = settings.confirmBeforeFill;
  state.activeForm = lookup.context ?? null;

  if (lookup.status !== "ready" || !lookup.context) {
    const isEditModeUrl =
      typeof lookup.pageUrl === "string" &&
      /\/forms\/.+\/edit(?:[?#]|$)/.test(lookup.pageUrl);
    const message =
      lookup.status === "invalid_url"
        ? isEditModeUrl
          ? "Open the live Google Form view page, not the editor URL."
          : "Open a Google Form URL like `docs.google.com/forms/...` in the current tab."
        : lookup.status === "unsupported_only"
          ? "This form was scanned, but only unsupported field types were detected."
          : "No active browser tab is available for scanning.";
    if (lookup.status === "unsupported_only" && lookup.context) {
      setReadyState();
      state.preset = await getPresetByFormKey(lookup.context.formKey);
      state.excludedFieldIds = new Set(state.preset?.excludedFieldIds ?? []);
      const suggestedProfileId = settings.autoLoadMatchingProfile
        ? getSuggestedProfileId()
        : null;
      state.selectedProfileId = normalizeSelectedProfileId(
        suggestedProfileId ?? settings.defaultProfileId,
      );
      formTitle.textContent = lookup.context.title;
      const sectionCount = getNamedSectionCount(lookup.context.fields);
      formMeta.textContent =
        sectionCount > 0
          ? `${lookup.context.fields.length} detected field${lookup.context.fields.length === 1 ? "" : "s"} across ${sectionCount} section${sectionCount === 1 ? "" : "s"}`
          : `${lookup.context.fields.length} detected field${lookup.context.fields.length === 1 ? "" : "s"}`;
      fieldsContainer.classList.remove("hidden");
      profileControls.classList.remove("hidden");
      renderProfileSelect();
      applyProfile(state.selectedProfileId, false);
      renderPresetActions();
      setStatus(
        state.preset
          ? `Loaded saved preset for this form. ${message}`
          : message,
        "idle",
      );
      return;
    }

    setInvalidPageState("Open a Google Form", message);
    renderProfileSelect();
    return;
  }

  const activeForm = lookup.context;
  setReadyState();

  const preset = await getPresetByFormKey(activeForm.formKey);
  state.preset = preset;
  state.excludedFieldIds = new Set(preset?.excludedFieldIds ?? []);

  const suggestedProfileId = settings.autoLoadMatchingProfile
    ? getSuggestedProfileId()
    : null;
  state.selectedProfileId = normalizeSelectedProfileId(
    suggestedProfileId ?? settings.defaultProfileId,
  );

  formTitle.textContent = activeForm.title;
  const sectionCount = getNamedSectionCount(activeForm.fields);
  formMeta.textContent =
    sectionCount > 0
      ? `${activeForm.fields.length} detected field${activeForm.fields.length === 1 ? "" : "s"} across ${sectionCount} section${sectionCount === 1 ? "" : "s"}`
      : `${activeForm.fields.length} detected field${activeForm.fields.length === 1 ? "" : "s"}`;
  fieldsContainer.classList.remove("hidden");
  profileControls.classList.remove("hidden");

  renderProfileSelect();
  applyProfile(state.selectedProfileId, false);
  renderPresetActions();

  setStatus(
    preset
      ? "Loaded saved preset for this form. Review values before filling."
      : "",
    "idle",
  );
}

async function handleFill(): Promise<void> {
  if (!state.activeForm) {
    return;
  }

  if (
    state.confirmBeforeFill &&
    !window.confirm("Fill the current Google Form with the reviewed values?")
  ) {
    return;
  }

  if (state.skippedFillFieldIds.length > 0) {
    state.skippedFillFieldIds = [];
    renderFields();
  }

  const localWarnings: string[] = [];
  try {
    await flushPendingPresetSave();
  } catch {
    localWarnings.push("Local preset was not saved.");
  }

  const result = await sendBackgroundMessage<FillResult>({
    type: "FILL_ACTIVE_FORM",
    payload: {
      formKey: state.activeForm.formKey,
      values: buildFillValues(),
      fields: state.activeForm.fields,
    },
  });
  if (!isFillResult(result)) {
    throw new Error("Background fill response was malformed");
  }
  state.skippedFillFieldIds = [...result.skippedFieldIds];

  const historyEntry = {
    id: crypto.randomUUID(),
    formKey: state.activeForm.formKey,
    formTitle: state.activeForm.title,
    formUrl: state.activeForm.url,
    lastUsedProfileId: state.selectedProfileId,
    lastUsedProfileName: getSelectedProfile()?.name ?? null,
    lastFilledAt: Date.now(),
    filledFieldCount: result.filledFieldIds.length,
    skippedFieldCount: result.skippedFieldIds.length,
  };
  let historySaved = false;

  const skippedLabels = result.skippedFieldIds.map(getFieldDisplayLabel);
  const skippedTypes = result.skippedFieldIds.map(getFieldType);
  const skippedAreOnlyDropdowns =
    result.skippedFieldIds.length > 0 &&
    skippedTypes.every((type) => type === "dropdown");
  const skippedSummary = skippedLabels.slice(0, 3).join(", ");
  const skippedSuffix =
    skippedLabels.length > 0
      ? ` Could not match: ${skippedSummary}${skippedLabels.length > 3 ? `, and ${skippedLabels.length - 3} more.` : "."}`
      : "";

  if (skippedAreOnlyDropdowns) {
    renderFields();
    try {
      await saveHistoryEntry(historyEntry);
      state.history = await getFormHistory();
      renderProfileSelect();
      historySaved = true;
    } catch {
      historySaved = false;
    }
    if (!historySaved) {
      localWarnings.push("Local history was not saved.");
    }
    setStatus(
      result.filledFieldIds.length > 0
        ? `Filled ${result.filledFieldIds.length} field(s). Review dropdown selections on the form before submitting.${localWarnings.length ? ` ${localWarnings.join(" ")}` : ""}`
        : `Review dropdown selections on the form before submitting.${localWarnings.length ? ` ${localWarnings.join(" ")}` : ""}`,
      "idle",
    );
    return;
  }

  renderFields();
  try {
    await saveHistoryEntry(historyEntry);
    state.history = await getFormHistory();
    renderProfileSelect();
    historySaved = true;
  } catch {
    historySaved = false;
  }
  if (!historySaved) {
    localWarnings.push("Local history was not saved.");
  }

  setStatus(
    result.skippedFieldIds.length
      ? `Filled ${result.filledFieldIds.length} field(s). ${result.skippedFieldIds.length} field(s) could not be matched.${skippedSuffix}${localWarnings.length ? ` ${localWarnings.join(" ")}` : ""}`
      : `Filled ${result.filledFieldIds.length} field(s).${localWarnings.length ? ` ${localWarnings.join(" ")}` : ""}`,
    result.skippedFieldIds.length ? "error" : "success",
  );
}

function handleClear(): void {
  const activeForm = state.activeForm;
  const persistedPresetSnapshot = clonePreset(state.preset);
  presetCommitVersion += 1;
  const clearCommitVersion = presetCommitVersion;

  if (autosaveTimer !== null) {
    window.clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }

  if (presetSaveInFlight) {
    const restorePromise = presetSaveInFlight
      .catch(() => undefined)
      .then(async () => {
        if (clearCommitVersion !== presetCommitVersion) {
          return;
        }

        if (persistedPresetSnapshot) {
          await savePreset(persistedPresetSnapshot);
        } else if (state.preset ?? pendingPresetId) {
          await deletePreset(state.preset?.id ?? pendingPresetId ?? "");
        }

        if (clearCommitVersion !== presetCommitVersion) {
          return;
        }

        state.preset = activeForm
          ? await getPresetByFormKey(activeForm.formKey)
          : null;
        pendingPresetId = state.preset?.id ?? pendingPresetId;
        renderPresetActions();
      })
      .finally(() => {
        if (presetSaveInFlight === restorePromise) {
          presetSaveInFlight = null;
        }
      });
    presetSaveInFlight = restorePromise;
  }

  if (state.activeForm) {
    state.clearedFieldIds = new Set(
      state.activeForm.fields.map((field) => field.id),
    );
    state.suppressedMappingFieldIds = new Set(
      state.activeForm.fields.map((field) => field.id),
    );
  } else {
    state.clearedFieldIds.clear();
    state.suppressedMappingFieldIds.clear();
  }
  state.values = {};
  state.mappings = {};
  state.unmappedFieldIds.clear();
  state.excludedFieldIds.clear();
  state.autoBrokenMappings.clear();
  state.preset = persistedPresetSnapshot;
  state.dirtyFieldIds.clear();
  state.skippedFillFieldIds = [];
  renderPresetActions();
  renderFields();
  setStatus("Cleared current popup values, mappings, and exclusions.", "idle");
}

async function handleResetPreset(): Promise<void> {
  if (!state.activeForm || !state.preset) {
    return;
  }

  if (!window.confirm("Reset the saved preset for this form?")) {
    return;
  }

  presetCommitVersion += 1;

  if (autosaveTimer !== null) {
    window.clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }

  if (presetSaveInFlight) {
    await presetSaveInFlight.catch(() => undefined);
  }

  await deletePreset(state.preset.id);
  if (pendingPresetId && pendingPresetId !== state.preset.id) {
    await deletePreset(pendingPresetId);
  }
  pendingPresetId = null;
  state.preset = null;
  state.values = {};
  state.mappings = {};
  state.unmappedFieldIds.clear();
  state.excludedFieldIds.clear();
  state.autoBrokenMappings.clear();
  state.dirtyFieldIds.clear();
  state.clearedFieldIds.clear();
  state.suppressedMappingFieldIds.clear();
  state.skippedFillFieldIds = [];
  applyProfile(state.selectedProfileId, false);
  renderPresetActions();
  setStatus("Reset the saved preset for this form.", "success");
}

profileSelect.addEventListener("change", () => {
  applyProfile(profileSelect.value || null);
});

resetPresetButton.addEventListener("click", () => {
  void handleResetPreset().catch((error) => {
    setStatus(
      error instanceof Error ? error.message : "Unable to reset preset",
      "error",
    );
  });
});

fillFormButton.addEventListener("click", () => {
  void handleFill().catch((error) => {
    setStatus(
      error instanceof Error
        ? error.message
        : "Unable to fill the current form.",
      "error",
    );
  });
});

clearValuesButton.addEventListener("click", handleClear);

openOptionsButton.addEventListener("click", () => {
  void runtimeOpenOptionsPage().catch((error) => {
    setStatus(
      error instanceof Error ? error.message : "Unable to open options page",
      "error",
    );
  });
});

window.addEventListener("pagehide", () => {
  void flushPendingPresetSave().catch(() => undefined);
});

window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  const isEditableTarget =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;

  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void handleFill().catch((error) => {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to fill the current form.",
        "error",
      );
    });
    return;
  }

  if (event.key === "/" && !isEditableTarget) {
    event.preventDefault();
    const firstFieldControl = fieldsContainer.querySelector<HTMLElement>(
      "input, textarea, select",
    );
    firstFieldControl?.focus();
  }
});

if (!hasChromeRuntime()) {
  setStatus("Open this UI through the Chrome extension popup.", "error");
} else {
  void loadPopup().catch((error) => {
    const message =
      error instanceof Error ? error.message : "Failed to load popup";
    setInvalidPageState("Unable to read this form", message);
    setStatus(message, "error");
  });
}

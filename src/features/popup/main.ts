import { hasChromeRuntime, runtimeOpenOptionsPage, runtimeSendMessage } from "../../core/chrome-api";
import { suggestProfileKey } from "../../core/matching";
import { normalizeText, optionEquals } from "../../core/normalization";
import { deletePreset, getPresetByFormKey, getProfiles, getSettings, savePreset } from "../../core/storage";
import type {
  ActiveFormContext,
  ActiveFormLookup,
  BackgroundRequest,
  ChoiceWithOtherValue,
  DetectedField,
  FieldValue,
  FillResult,
  FormPreset,
  MessageResponse,
  Profile,
} from "../../core/types";

type PopupState = {
  activeForm: ActiveFormContext | null;
  profiles: Profile[];
  selectedProfileId: string | null;
  values: Record<string, FieldValue>;
  mappings: Record<string, string>;
  unmappedFieldIds: Set<string>;
  autoBrokenMappings: Map<string, string>;
  dirtyFieldIds: Set<string>;
  clearedFieldIds: Set<string>;
  suppressedMappingFieldIds: Set<string>;
  preset: FormPreset | null;
  autoLoadMatchingProfile: boolean;
  confirmBeforeFill: boolean;
};

const state: PopupState = {
  activeForm: null,
  profiles: [],
  selectedProfileId: null,
  values: {},
  mappings: {},
  unmappedFieldIds: new Set<string>(),
  autoBrokenMappings: new Map<string, string>(),
  dirtyFieldIds: new Set<string>(),
  clearedFieldIds: new Set<string>(),
  suppressedMappingFieldIds: new Set<string>(),
  preset: null,
  autoLoadMatchingProfile: true,
  confirmBeforeFill: true,
};

const AUTOSAVE_DELAY_MS = 500;

const formTitle = document.querySelector<HTMLHeadingElement>("#form-title")!;
const formMeta = document.querySelector<HTMLParagraphElement>("#form-meta")!;
const statusCard = document.querySelector<HTMLDivElement>("#status-card")!;
const errorCard = document.querySelector<HTMLDivElement>("#error-card")!;
const errorTitle = document.querySelector<HTMLHeadingElement>("#error-title")!;
const errorMessage = document.querySelector<HTMLParagraphElement>("#error-message")!;
const profileControls = document.querySelector<HTMLDivElement>("#profile-controls")!;
const fieldsContainer = document.querySelector<HTMLDivElement>("#fields")!;
const profileSelect = document.querySelector<HTMLSelectElement>("#profile-select")!;
const resetPresetButton = document.querySelector<HTMLButtonElement>("#reset-preset")!;
const fillFormButton = document.querySelector<HTMLButtonElement>("#fill-form")!;
const clearValuesButton = document.querySelector<HTMLButtonElement>("#clear-values")!;
const openOptionsButton = document.querySelector<HTMLButtonElement>("#open-options")!;

let autosaveTimer: number | null = null;
let presetSaveInFlight: Promise<void> | null = null;
let presetCommitVersion = 0;
let pendingPresetId: string | null = null;

function setStatus(message: string, mode: "idle" | "error" | "success" = "idle"): void {
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
  return state.profiles.find((profile) => profile.id === state.selectedProfileId) ?? null;
}

function normalizeSelectedProfileId(profileId: string | null): string | null {
  if (!profileId) {
    return null;
  }

  return state.profiles.some((profile) => profile.id === profileId) ? profileId : null;
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

async function sendBackgroundMessage<T>(message: BackgroundRequest): Promise<T> {
  const response = (await runtimeSendMessage<MessageResponse<T>>(message)) as MessageResponse<T>;
  if (!response?.ok) {
    throw new Error(response?.error ?? "Background request failed");
  }

  return response.data as T;
}

function renderProfileSelect(): void {
  profileSelect.replaceChildren();

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "No profile";
  profileSelect.append(emptyOption);

  for (const profile of state.profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    if (profile.id === state.selectedProfileId) {
      option.selected = true;
    }
    profileSelect.append(option);
  }
}

function updateFieldValue(fieldId: string, value: FieldValue, markDirty = true): void {
  let shouldMarkDirty = markDirty;
  let mappingStateChanged = false;

  if (markDirty) {
    const field = state.activeForm?.fields.find((candidate) => candidate.id === fieldId);
    const profile = getSelectedProfile();
    const currentMapping = state.mappings[fieldId];
    const mappedValue = field && profile && currentMapping ? coerceFieldValueForField(field, profile.values[currentMapping]) : undefined;

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
        (brokenMapping && coerceFieldValueForField(field, profile.values[brokenMapping]) !== undefined ? brokenMapping : undefined) ??
        (state.preset?.mappings?.[fieldId] && coerceFieldValueForField(field, profile.values[state.preset.mappings[fieldId]]) !== undefined
          ? state.preset.mappings[fieldId]
          : undefined) ??
        suggestProfileKey(field, profile);

      if (preferredMapping) {
        const preferredMappedValue = coerceFieldValueForField(field, profile.values[preferredMapping]);
        if (preferredMappedValue !== undefined && fieldValuesEqual(value, preferredMappedValue)) {
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
  if (shouldMarkDirty) {
    state.dirtyFieldIds.add(fieldId);
  } else {
    clearDirtyField(fieldId);
  }
  schedulePresetSave();

  if (mappingStateChanged) {
    renderFields();
  }
}

function fieldValuesEqual(left: FieldValue | undefined, right: FieldValue | undefined): boolean {
  if (left === undefined || left === null || right === undefined || right === null) {
    return (left ?? null) === (right ?? null);
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return compareOptionArrays(left.map(String), right.map(String));
  }

  if (isChoiceWithOtherValue(left) && isChoiceWithOtherValue(right)) {
    if (Array.isArray(left.selected) && Array.isArray(right.selected)) {
      return compareOptionArrays(left.selected.map(String), right.selected.map(String)) && left.otherText === right.otherText;
    }

    if (typeof left.selected === "string" && typeof right.selected === "string") {
      return optionEquals(left.selected, right.selected) && left.otherText === right.otherText;
    }

    return false;
  }

  return JSON.stringify(left) === JSON.stringify(right);
}

function isChoiceWithOtherValue(value: FieldValue): value is ChoiceWithOtherValue {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "choice_with_other";
}

function clearDirtyField(fieldId: string): void {
  state.dirtyFieldIds.delete(fieldId);
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

  return true;
}

function compareOptionArrays(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const normalizedLeft = left.map((item) => normalizeText(item)).sort();
  const normalizedRight = right.map((item) => normalizeText(item)).sort();
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function clonePreset(preset: FormPreset | null): FormPreset | null {
  return preset ? structuredClone(preset) : null;
}

function findMatchingOption(field: DetectedField, value: string): string | undefined {
  return field.options?.find((option) => optionEquals(option, value));
}

function isValidDateValue(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isValidTimeValue(value: string): boolean {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) {
    return false;
  }

  const [, hoursText, minutesText, secondsText] = match;
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  const seconds = secondsText === undefined ? 0 : Number(secondsText);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59;
}

function normalizeCheckboxValues(
  field: DetectedField,
  values: string[],
  otherTextOverride?: string,
): FieldValue | undefined {
  const selected: string[] = [];
  const unmatched: string[] = [];
  let otherSelected = false;

  for (const rawValue of values) {
    const trimmedValue = rawValue.trim();
    if (!trimmedValue) {
      continue;
    }

    if (field.otherOption && optionEquals(trimmedValue, field.otherOption)) {
      if (!selected.some((value) => optionEquals(value, field.otherOption as string))) {
        selected.push(field.otherOption);
      }
      otherSelected = true;
      continue;
    }

    const matchedOption = findMatchingOption(field, trimmedValue);
    if (matchedOption) {
      if (!selected.some((value) => optionEquals(value, matchedOption))) {
        selected.push(matchedOption);
      }
      continue;
    }

    unmatched.push(trimmedValue);
  }

  if (unmatched.length > 1) {
    return undefined;
  }

  if (unmatched.length === 1) {
    if (!field.otherOption) {
      return undefined;
    }

    if (!selected.some((value) => optionEquals(value, field.otherOption as string))) {
      selected.push(field.otherOption);
    }

    return {
      kind: "choice_with_other",
      selected,
      otherText: unmatched[0],
    };
  }

  if (otherSelected) {
    const trimmedOtherText = (otherTextOverride ?? "").trim();
    if (!trimmedOtherText) {
      const selectedWithoutOther = selected.filter((value) => !optionEquals(value, field.otherOption as string));
      return selectedWithoutOther.length > 0 ? selectedWithoutOther : undefined;
    }

    return {
      kind: "choice_with_other",
      selected,
      otherText: trimmedOtherText,
    };
  }

  return selected.length > 0 ? selected : undefined;
}

function coerceFieldValueForField(field: DetectedField, value: FieldValue | Profile["values"][string] | undefined): FieldValue | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  switch (field.type) {
    case "checkbox":
      if (isChoiceWithOtherValue(value)) {
        return Array.isArray(value.selected)
          ? normalizeCheckboxValues(field, value.selected.map(String), value.otherText)
          : undefined;
      }

      if (typeof value === "string") {
        return normalizeCheckboxValues(field, [value]);
      }

      if (Array.isArray(value)) {
        return normalizeCheckboxValues(field, value.map(String));
      }

      return undefined;
    case "date":
      return typeof value === "string" && isValidDateValue(value) ? value : undefined;
    case "time":
      return typeof value === "string" && isValidTimeValue(value) ? value : undefined;
    case "radio":
    case "scale":
    case "dropdown": {
      if (isChoiceWithOtherValue(value)) {
        if (field.type === "dropdown" || typeof value.selected !== "string") {
          return undefined;
        }

        if (field.otherOption && optionEquals(value.selected, field.otherOption)) {
          if (!value.otherText.trim()) {
            return undefined;
          }

          return {
            kind: "choice_with_other",
            selected: field.otherOption,
            otherText: value.otherText,
          };
        }

        const matchedOption = findMatchingOption(field, String(value.selected));
        return matchedOption;
      }

      if (typeof value !== "string" && typeof value !== "number") {
        return undefined;
      }

      const normalizedValue = String(value);
      const matchedOption = findMatchingOption(field, normalizedValue);
      if (matchedOption) {
        return matchedOption;
      }

      if ((field.type === "radio" || field.type === "scale") && field.otherOption) {
        return {
          kind: "choice_with_other",
          selected: field.otherOption,
          otherText: normalizedValue,
        };
      }

      return undefined;
    }
    case "text":
    case "textarea":
      return typeof value === "string" || typeof value === "number" ? value : undefined;
    default:
      return undefined;
  }
}

function buildFillValues(): Record<string, FieldValue> {
  if (!state.activeForm) {
    return {};
  }

  return Object.fromEntries(
    state.activeForm.fields
      .map((field) => [field.id, coerceFieldValueForField(field, state.values[field.id])] as const)
      .filter(([, value]) => hasPersistableFieldValue(value)),
  ) as Record<string, FieldValue>;
}

function updateFieldMapping(fieldId: string, value: string): void {
  const field = state.activeForm?.fields.find((candidate) => candidate.id === fieldId);
  const profile = getSelectedProfile();
  const previousMapping = state.mappings[fieldId];

  if (!value) {
    delete state.mappings[fieldId];
    state.unmappedFieldIds.add(fieldId);
    state.suppressedMappingFieldIds.add(fieldId);
    state.autoBrokenMappings.delete(fieldId);

    if (field && profile && previousMapping) {
      const previousMappedValue = coerceFieldValueForField(field, profile.values[previousMapping]);
      if (fieldValuesEqual(state.values[fieldId], previousMappedValue)) {
        const presetValue = state.preset?.values[fieldId];
        if (presetValue !== undefined) {
          state.values[fieldId] = presetValue;
        } else {
          delete state.values[fieldId];
        }
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

  const values = Object.fromEntries(
    state.activeForm.fields
      .map((field) => [field.id, coerceFieldValueForField(field, state.values[field.id])] as const)
      .filter(([, value]) => hasPersistableFieldValue(value)),
  ) as Record<string, FieldValue>;
  const hasValues = Object.keys(values).length > 0;
  const hasMappings = Object.keys(state.mappings).length > 0 || state.unmappedFieldIds.size > 0;
  if (!hasValues && !hasMappings) {
    return null;
  }

  const now = Date.now();
  return {
    id: state.preset?.id ?? crypto.randomUUID(),
    formKey: state.activeForm.formKey,
    name: state.preset?.name ?? state.activeForm.title,
    formTitle: state.activeForm.title,
    formUrl: state.activeForm.url,
    fields: state.activeForm.fields,
    values,
    mappings: { ...state.mappings },
    ...(state.unmappedFieldIds.size ? { unmappedFieldIds: Array.from(state.unmappedFieldIds) } : {}),
    mappingSchemaVersion: 2,
    createdAt: state.preset?.createdAt ?? now,
    updatedAt: now,
  };
}

async function persistPreset(showStatus = false): Promise<void> {
  const commitVersion = presetCommitVersion;
  const preset = buildPresetPayload();
  pendingPresetId = preset?.id ?? state.preset?.id ?? pendingPresetId;
  if (!preset) {
    if (state.preset) {
      await deletePreset(state.preset.id);
      if (commitVersion === presetCommitVersion) {
        state.preset = null;
        renderPresetActions();
      }
    }
    return;
  }

  await savePreset(preset);
  if (commitVersion !== presetCommitVersion) {
    return;
  }

  state.preset = preset;
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
  if (hadScheduledSave) {
    if (autosaveTimer !== null) {
      window.clearTimeout(autosaveTimer);
    }
    autosaveTimer = null;
  }

  if (presetSaveInFlight) {
    await presetSaveInFlight;
  }

  if (hadScheduledSave) {
    await runPresetPersist();
  }
}

function renderPresetActions(): void {
  resetPresetButton.disabled = !state.preset;
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
      setStatus(error instanceof Error ? error.message : "Unable to save preset", "error");
    });
  }, AUTOSAVE_DELAY_MS);
}

function createValueControl(field: DetectedField, value: FieldValue): HTMLElement {
  switch (field.type) {
    case "textarea": {
      const textarea = document.createElement("textarea");
      textarea.rows = 3;
      textarea.value = typeof value === "string" ? value : "";
      textarea.addEventListener("input", () => updateFieldValue(field.id, textarea.value));
      return textarea;
    }
    case "radio":
    case "scale": {
      const wrapper = document.createElement("div");
      wrapper.className = "choice-with-other";

      const select = document.createElement("select");
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "Select an option";
      select.append(empty);

      const selectedValue = isChoiceWithOtherValue(value) && typeof value.selected === "string" ? value.selected : String(value ?? "");
      const otherText = isChoiceWithOtherValue(value) ? value.otherText : "";

      for (const optionValue of field.options ?? []) {
        const option = document.createElement("option");
        option.value = optionValue;
        option.textContent = optionValue;
        option.selected = selectedValue === optionValue;
        select.append(option);
      }

      select.addEventListener("change", () => {
        if (field.otherOption && select.value === field.otherOption) {
          updateFieldValue(field.id, {
            kind: "choice_with_other",
            selected: select.value,
            otherText,
          });
          renderFields();
          return;
        }

        updateFieldValue(field.id, select.value || null);
        renderFields();
      });

      wrapper.append(select);

      if (field.otherOption && selectedValue === field.otherOption) {
        const otherInput = document.createElement("input");
        otherInput.type = "text";
        otherInput.className = "other-text-input";
        otherInput.placeholder = `Enter ${field.otherOption.toLowerCase()} value`;
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
    case "dropdown": {
      const select = document.createElement("select");
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "Select an option";
      select.append(empty);

      for (const optionValue of field.options ?? []) {
        const option = document.createElement("option");
        option.value = optionValue;
        option.textContent = optionValue;
        option.selected = String(value ?? "") === optionValue;
        select.append(option);
      }

      select.addEventListener("change", () => updateFieldValue(field.id, select.value || null));
      return select;
    }
    case "date":
    case "time": {
      const input = document.createElement("input");
      input.type = field.type;
      input.value = typeof value === "string" ? value : "";
      input.addEventListener("input", () => updateFieldValue(field.id, input.value || null));
      return input;
    }
    case "checkbox": {
      const wrapper = document.createElement("div");
      wrapper.className = "checkbox-list";
      const selectedValues = isChoiceWithOtherValue(value) && Array.isArray(value.selected) ? value.selected : Array.isArray(value) ? value.map(String) : [];
      const selected = new Set(selectedValues);
      const getCurrentSelectedValues = (): string[] => {
        const current = state.values[field.id];
        if (isChoiceWithOtherValue(current) && Array.isArray(current.selected)) {
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
        otherInput.placeholder = `Enter ${field.otherOption.toLowerCase()} value`;
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
    default: {
      const input = document.createElement("input");
      input.type = "text";
      input.value = typeof value === "string" || typeof value === "number" ? String(value) : "";
      input.placeholder = "Enter a value";
      input.addEventListener("input", () => updateFieldValue(field.id, input.value));
      return input;
    }
  }
}

function renderFields(): void {
  fieldsContainer.replaceChildren();

  if (!state.activeForm) {
    return;
  }

  const profile = getSelectedProfile();

  for (const field of state.activeForm.fields) {
    const card = document.createElement("article");
    card.className = "field-card";

    const header = document.createElement("div");
    header.className = "field-head";

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

    header.append(label);

    const body = document.createElement("div");
    body.className = "field-body";
    body.append(createValueControl(field, state.values[field.id] ?? null));

    if (profile) {
      const compatibleProfileKeys = Object.keys(profile.values).filter((key) =>
        coerceFieldValueForField(field, profile.values[key]) !== undefined,
      );
      const mappingRow = document.createElement("label");
      mappingRow.className = "mapping-row";

      const mappingLabel = document.createElement("span");
      mappingLabel.textContent = "Mapped profile key";

      const mappingSelect = document.createElement("select");
      const noneOption = document.createElement("option");
      noneOption.value = "";
      noneOption.textContent = "No mapping";
      noneOption.selected = state.unmappedFieldIds.has(field.id) || !state.mappings[field.id];
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

    card.append(header, body);
    fieldsContainer.append(card);
  }
}

function applyProfile(profileId: string | null, autosave = true): void {
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

  for (const field of state.activeForm.fields) {
    if (state.clearedFieldIds.has(field.id)) {
      continue;
    }

    const currentMapping = previousMappings[field.id];
    const presetMapping = presetMappings[field.id];
    const isMappingSuppressed = state.suppressedMappingFieldIds.has(field.id);
    const hasExplicitNoMapping = previousUnmappedFieldIds.has(field.id) || presetUnmappedFieldIds.has(field.id);
    const suggestedMapping = profile ? suggestProfileKey(field, profile) : undefined;
    const mappingKey =
      isMappingSuppressed || hasExplicitNoMapping
        ? undefined
        : ((profile && currentMapping && coerceFieldValueForField(field, profile.values[currentMapping]) !== undefined ? currentMapping : undefined) ??
          (profile && presetMapping && coerceFieldValueForField(field, profile.values[presetMapping]) !== undefined ? presetMapping : undefined) ??
          (profile && suggestedMapping && coerceFieldValueForField(field, profile.values[suggestedMapping]) !== undefined ? suggestedMapping : undefined));

    if (mappingKey) {
      nextMappings[field.id] = mappingKey;
    } else if (hasExplicitNoMapping && !isMappingSuppressed) {
      nextUnmappedFieldIds.add(field.id);
    }

    if (state.dirtyFieldIds.has(field.id) && previousValues[field.id] !== undefined) {
      nextValues[field.id] = previousValues[field.id];
      continue;
    }

    const mappedValue = mappingKey ? coerceFieldValueForField(field, profile?.values[mappingKey]) : undefined;
    if (mappedValue !== undefined) {
      nextValues[field.id] = mappedValue;
      continue;
    }

    const presetValue = coerceFieldValueForField(field, presetValues[field.id]);
    if (presetValue !== undefined) {
      nextValues[field.id] = presetValue;
      continue;
    }

    const previousMappedValue = currentMapping ? coerceFieldValueForField(field, previousProfile?.values[currentMapping]) : undefined;
    if (
      previousValues[field.id] !== undefined &&
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
  renderProfileSelect();
  renderPresetActions();
  renderFields();
  if (autosave) {
    schedulePresetSave();
  }
}

async function loadPopup(): Promise<void> {
  const [profiles, settings, lookup] = await Promise.all([
    getProfiles(),
    getSettings(),
    sendBackgroundMessage<ActiveFormLookup>({ type: "GET_ACTIVE_FORM_CONTEXT" }),
  ]);

  state.profiles = profiles;
  state.autoLoadMatchingProfile = settings.autoLoadMatchingProfile;
  state.confirmBeforeFill = settings.confirmBeforeFill;
  state.activeForm = lookup.context ?? null;

  if (lookup.status !== "ready" || !lookup.context) {
    const message =
      lookup.status === "invalid_url"
        ? "Open a Google Form URL like `docs.google.com/forms/...` in the current tab."
        : "No active browser tab is available for scanning.";
    setInvalidPageState("Open a Google Form", message);
    renderProfileSelect();
    return;
  }

  const activeForm = lookup.context;
  setReadyState();

  const preset = await getPresetByFormKey(activeForm.formKey);
  state.preset = preset;

  state.selectedProfileId = normalizeSelectedProfileId(
    settings.autoLoadMatchingProfile ? settings.defaultProfileId : null,
  );

  formTitle.textContent = activeForm.title;
  formMeta.textContent = `${activeForm.fields.length} detected field${activeForm.fields.length === 1 ? "" : "s"}`;
  fieldsContainer.classList.remove("hidden");
  profileControls.classList.remove("hidden");

  renderProfileSelect();
  applyProfile(state.selectedProfileId, false);
  renderPresetActions();

  setStatus(
    preset
      ? "Loaded saved preset for this form. Review values before filling."
      : "",
    "success",
  );
}

async function handleFill(): Promise<void> {
  if (!state.activeForm) {
    return;
  }

  if (state.confirmBeforeFill && !window.confirm("Fill the current Google Form with the reviewed values?")) {
    return;
  }

  await flushPendingPresetSave();

  const result = await sendBackgroundMessage<FillResult>({
    type: "FILL_ACTIVE_FORM",
    payload: {
      formKey: state.activeForm.formKey,
      values: buildFillValues(),
      fields: state.activeForm.fields,
    },
  });

  setStatus(
    result.skippedFieldIds.length
      ? `Filled ${result.filledFieldIds.length} field(s). ${result.skippedFieldIds.length} field(s) could not be matched.`
      : `Filled ${result.filledFieldIds.length} field(s).`,
    result.skippedFieldIds.length ? "error" : "success",
  );
}

function handleClear(): void {
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
      })
      .finally(() => {
        if (presetSaveInFlight === restorePromise) {
          presetSaveInFlight = null;
        }
      });
    presetSaveInFlight = restorePromise;
  }

  if (state.activeForm) {
    state.clearedFieldIds = new Set(state.activeForm.fields.map((field) => field.id));
    state.suppressedMappingFieldIds = new Set(state.activeForm.fields.map((field) => field.id));
  } else {
    state.clearedFieldIds.clear();
    state.suppressedMappingFieldIds.clear();
  }
  state.values = {};
  state.mappings = {};
  state.unmappedFieldIds.clear();
  state.autoBrokenMappings.clear();
  state.preset = persistedPresetSnapshot;
  state.dirtyFieldIds.clear();
  renderPresetActions();
  renderFields();
  setStatus("Cleared current popup values and mappings.", "idle");
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
  state.autoBrokenMappings.clear();
  state.dirtyFieldIds.clear();
  state.clearedFieldIds.clear();
  state.suppressedMappingFieldIds.clear();
  applyProfile(state.selectedProfileId, false);
  renderPresetActions();
  setStatus("Reset the saved preset for this form.", "success");
}

profileSelect.addEventListener("change", () => {
  applyProfile(profileSelect.value || null);
});

resetPresetButton.addEventListener("click", () => {
  void handleResetPreset().catch((error) => {
    setStatus(error instanceof Error ? error.message : "Unable to reset preset", "error");
  });
});

fillFormButton.addEventListener("click", () => {
  void handleFill().catch((error) => {
    setStatus(error instanceof Error ? error.message : "Unable to fill the current form.", "error");
  });
});

clearValuesButton.addEventListener("click", handleClear);

openOptionsButton.addEventListener("click", () => {
  void runtimeOpenOptionsPage().catch((error) => {
    setStatus(error instanceof Error ? error.message : "Unable to open options page", "error");
  });
});

window.addEventListener("pagehide", () => {
  void flushPendingPresetSave().catch(() => undefined);
});

if (!hasChromeRuntime()) {
  setStatus("Open this UI through the Chrome extension popup.", "error");
} else {
  void loadPopup().catch((error) => {
    const message = error instanceof Error ? error.message : "Failed to load popup";
    setInvalidPageState("Unable to read this form", message);
    setStatus(message, "error");
  });
}

import { hasChromeRuntime, runtimeOpenOptionsPage, runtimeSendMessage } from "../../core/chrome-api";
import { buildInitialFieldValues } from "../../core/matching";
import { getPresetByFormKey, getProfiles, getSettings, savePreset } from "../../core/storage";
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
  preset: null,
  autoLoadMatchingProfile: true,
  confirmBeforeFill: true,
};

const formTitle = document.querySelector<HTMLHeadingElement>("#form-title")!;
const formMeta = document.querySelector<HTMLParagraphElement>("#form-meta")!;
const statusCard = document.querySelector<HTMLDivElement>("#status-card")!;
const errorCard = document.querySelector<HTMLDivElement>("#error-card")!;
const errorTitle = document.querySelector<HTMLHeadingElement>("#error-title")!;
const errorMessage = document.querySelector<HTMLParagraphElement>("#error-message")!;
const profileControls = document.querySelector<HTMLDivElement>("#profile-controls")!;
const fieldsContainer = document.querySelector<HTMLDivElement>("#fields")!;
const profileSelect = document.querySelector<HTMLSelectElement>("#profile-select")!;
const savePresetButton = document.querySelector<HTMLButtonElement>("#save-preset")!;
const fillFormButton = document.querySelector<HTMLButtonElement>("#fill-form")!;
const clearValuesButton = document.querySelector<HTMLButtonElement>("#clear-values")!;
const openOptionsButton = document.querySelector<HTMLButtonElement>("#open-options")!;

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
  statusCard.classList.remove("hidden");
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

function updateFieldValue(fieldId: string, value: FieldValue): void {
  state.values[fieldId] = value;
}

function fieldValuesEqual(left: FieldValue | undefined, right: FieldValue | undefined): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function isChoiceWithOtherValue(value: FieldValue): value is ChoiceWithOtherValue {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "choice_with_other";
}

function updateFieldMapping(fieldId: string, value: string): void {
  const profile = getSelectedProfile();
  const previousMapping = state.mappings[fieldId];

  if (!value) {
    delete state.mappings[fieldId];

    if (profile && previousMapping) {
      const previousMappedValue = profile.values[previousMapping] as FieldValue | undefined;
      if (fieldValuesEqual(state.values[fieldId], previousMappedValue)) {
        const presetValue = state.preset?.values[fieldId];
        if (presetValue !== undefined) {
          state.values[fieldId] = presetValue;
        } else {
          delete state.values[fieldId];
        }
      }
    }

    return;
  }

  state.mappings[fieldId] = value;

  if (!profile) {
    return;
  }

  const mappedValue = profile.values[value];
  if (mappedValue !== undefined) {
    state.values[fieldId] = mappedValue;
  }
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
    case "checkbox": {
      const wrapper = document.createElement("div");
      wrapper.className = "checkbox-list";
      const selectedValues = isChoiceWithOtherValue(value) && Array.isArray(value.selected) ? value.selected : Array.isArray(value) ? value.map(String) : [];
      const selected = new Set(selectedValues);
      const otherText = isChoiceWithOtherValue(value) ? value.otherText : "";

      for (const optionValue of field.options ?? []) {
        const label = document.createElement("label");
        label.className = "checkbox-item";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selected.has(optionValue);
        checkbox.addEventListener("change", () => {
          const current = state.values[field.id];
          const existing = isChoiceWithOtherValue(current) && Array.isArray(current.selected) ? current.selected : Array.isArray(current) ? current.map(String) : [];
          const next = new Set(existing);
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
              otherText,
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
        otherInput.value = otherText;
        otherInput.addEventListener("input", () =>
          updateFieldValue(field.id, {
            kind: "choice_with_other",
            selected: Array.from(selected),
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
  const profileKeys = profile ? Object.keys(profile.values) : [];

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
      const mappingRow = document.createElement("label");
      mappingRow.className = "mapping-row";

      const mappingLabel = document.createElement("span");
      mappingLabel.textContent = "Mapped profile key";

      const mappingSelect = document.createElement("select");
      const noneOption = document.createElement("option");
      noneOption.value = "";
      noneOption.textContent = "No mapping";
      mappingSelect.append(noneOption);

      for (const key of profileKeys) {
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

function applyProfile(profileId: string | null): void {
  state.selectedProfileId = normalizeSelectedProfileId(profileId);
  const profile = getSelectedProfile();

  if (!state.activeForm) {
    return;
  }

  const initial = buildInitialFieldValues(
    state.activeForm.fields,
    state.preset?.values ?? {},
    state.preset?.mappings,
    profile,
  );

  state.values = initial.values;
  state.mappings = initial.mappings;
  renderProfileSelect();
  renderFields();
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
        ? "Open a Google Form URL like `docs.google.com/forms/...` or `forms.gle/...` in the current tab."
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
  applyProfile(state.selectedProfileId);

  setStatus(preset ? "Loaded saved preset for this form. Review values before filling." : "", "success");
}

async function handleSavePreset(): Promise<void> {
  if (!state.activeForm) {
    return;
  }

  const now = Date.now();
  const preset: FormPreset = {
    id: state.preset?.id ?? crypto.randomUUID(),
    formKey: state.activeForm.formKey,
    name: state.preset?.name ?? state.activeForm.title,
    formTitle: state.activeForm.title,
    formUrl: state.activeForm.url,
    fields: state.activeForm.fields,
    values: state.values,
    mappings: state.mappings,
    createdAt: state.preset?.createdAt ?? now,
    updatedAt: now,
  };

  await savePreset(preset);
  state.preset = preset;
  setStatus("Preset saved locally for this form.", "success");
}

async function handleFill(): Promise<void> {
  if (!state.activeForm) {
    return;
  }

  if (state.confirmBeforeFill && !window.confirm("Fill the current Google Form with the reviewed values?")) {
    return;
  }

  const result = await sendBackgroundMessage<FillResult>({
    type: "FILL_ACTIVE_FORM",
    payload: {
      formKey: state.activeForm.formKey,
      values: state.values,
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
  state.values = {};
  state.mappings = {};
  renderFields();
  setStatus("Cleared unsaved values and mappings in the popup.", "idle");
}

profileSelect.addEventListener("change", () => {
  applyProfile(profileSelect.value || null);
});

savePresetButton.addEventListener("click", () => {
  void handleSavePreset();
});

fillFormButton.addEventListener("click", () => {
  void handleFill();
});

clearValuesButton.addEventListener("click", handleClear);

openOptionsButton.addEventListener("click", () => {
  void runtimeOpenOptionsPage().catch((error) => {
    setStatus(error instanceof Error ? error.message : "Unable to open options page", "error");
  });
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

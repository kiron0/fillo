import { hasChromeRuntime } from "../../core/chrome-api";
import {
  clearAllData,
  clearHistory,
  deletePreset,
  deleteProfile,
  exportAppData,
  getFormHistory,
  getPresets,
  getProfiles,
  getSettings,
  importAppData,
  saveProfile,
  savePreset,
  saveSettings,
} from "../../core/storage";
import { validateImportedAppData } from "../../core/storage-ops";
import { DEFAULT_EXPORT_SELECTION } from "../../core/types";
import type { AppSettings, ExportSelection, FormHistoryEntry, FormPreset, ImportedAppData, Profile } from "../../core/types";

const statusNode = document.querySelector<HTMLParagraphElement>("#status")!;
const defaultProfileSelect = document.querySelector<HTMLSelectElement>("#default-profile")!;
const autoLoadCheckbox = document.querySelector<HTMLInputElement>("#auto-load-profile")!;
const confirmBeforeFillCheckbox = document.querySelector<HTMLInputElement>("#confirm-before-fill")!;
const showBackupSectionCheckbox = document.querySelector<HTMLInputElement>("#show-backup-section")!;
const addProfileButton = document.querySelector<HTMLButtonElement>("#add-profile")!;
const profilesContainer = document.querySelector<HTMLDivElement>("#profiles")!;
const presetsContainer = document.querySelector<HTMLDivElement>("#presets")!;
const historyContainer = document.querySelector<HTMLDivElement>("#history");
const backupSection = document.querySelector<HTMLDivElement>("#backup-section")!;
const exportButton = document.querySelector<HTMLButtonElement>("#export-data")!;
const importButton = document.querySelector<HTMLButtonElement>("#import-data")!;
const clearDataButton = document.querySelector<HTMLButtonElement>("#clear-data")!;
const clearHistoryButton = document.querySelector<HTMLButtonElement>("#clear-history");
const backupPayload = document.querySelector<HTMLTextAreaElement>("#backup-payload")!;
const storageSummary = document.querySelector<HTMLDivElement>("#storage-summary");
const exportProfilesCheckbox = document.querySelector<HTMLInputElement>("#export-profiles");
const exportPresetsCheckbox = document.querySelector<HTMLInputElement>("#export-presets");
const exportSettingsCheckbox = document.querySelector<HTMLInputElement>("#export-settings");
const exportHistoryCheckbox = document.querySelector<HTMLInputElement>("#export-history");
const importProfilesCheckbox = document.querySelector<HTMLInputElement>("#import-profiles");
const importPresetsCheckbox = document.querySelector<HTMLInputElement>("#import-presets");
const importSettingsCheckbox = document.querySelector<HTMLInputElement>("#import-settings");
const importHistoryCheckbox = document.querySelector<HTMLInputElement>("#import-history");

const state: {
  profiles: Profile[];
  presets: FormPreset[];
  history: FormHistoryEntry[];
  settings: AppSettings;
} = {
  profiles: [],
  presets: [],
  history: [],
  settings: {
    defaultProfileId: null,
    autoLoadMatchingProfile: true,
    confirmBeforeFill: true,
    showBackupSection: false,
  },
};

let settingsSaveQueue: Promise<void> = Promise.resolve();
let latestSettingsRequestId = 0;

function setStatus(message: string): void {
  statusNode.textContent = message;
}

function readSettingsControls(): AppSettings {
  return {
    defaultProfileId: defaultProfileSelect.value || null,
    autoLoadMatchingProfile: autoLoadCheckbox.checked,
    confirmBeforeFill: confirmBeforeFillCheckbox.checked,
    showBackupSection: showBackupSectionCheckbox.checked,
  };
}

function restoreSettingsControls(settings: AppSettings): void {
  state.settings = settings;
  renderDefaultProfileOptions();
  autoLoadCheckbox.checked = settings.autoLoadMatchingProfile;
  confirmBeforeFillCheckbox.checked = settings.confirmBeforeFill;
  showBackupSectionCheckbox.checked = settings.showBackupSection;
  backupSection.classList.toggle("hidden", !settings.showBackupSection);
}

function readExportSelectionControls(): ExportSelection {
  return {
    profiles: exportProfilesCheckbox?.checked ?? DEFAULT_EXPORT_SELECTION.profiles,
    presets: exportPresetsCheckbox?.checked ?? DEFAULT_EXPORT_SELECTION.presets,
    settings: exportSettingsCheckbox?.checked ?? DEFAULT_EXPORT_SELECTION.settings,
    history: exportHistoryCheckbox?.checked ?? DEFAULT_EXPORT_SELECTION.history,
  };
}

function readImportSelectionControls(): ExportSelection {
  return {
    profiles: importProfilesCheckbox?.checked ?? DEFAULT_EXPORT_SELECTION.profiles,
    presets: importPresetsCheckbox?.checked ?? DEFAULT_EXPORT_SELECTION.presets,
    settings: importSettingsCheckbox?.checked ?? DEFAULT_EXPORT_SELECTION.settings,
    history: importHistoryCheckbox?.checked ?? DEFAULT_EXPORT_SELECTION.history,
  };
}

function getProfileValueKind(value: string | number | boolean | string[]): "string" | "number" | "boolean" | "array" {
  if (Array.isArray(value)) {
    return "array";
  }

  if (typeof value === "number") {
    return "number";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  return "string";
}

function isImportedData(value: unknown): value is ImportedAppData {
  return validateImportedAppData(value);
}

function createEmptyProfile(): Profile {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: "New Profile",
    values: {
      fullName: "",
      email: "",
    },
    aliases: {
      fullName: ["name", "applicant name"],
      email: ["email address"],
    },
    createdAt: now,
    updatedAt: now,
  };
}

function renderDefaultProfileOptions(): void {
  defaultProfileSelect.replaceChildren();

  const none = document.createElement("option");
  none.value = "";
  none.textContent = "No default profile";
  defaultProfileSelect.append(none);

  for (const profile of state.profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    option.selected = state.settings.defaultProfileId === profile.id;
    defaultProfileSelect.append(option);
  }
}

function createProfileValueRow(
  key: string,
  value: string | number | boolean | string[],
  aliases: string[],
  onDelete: () => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "value-row";

  const keyInput = document.createElement("input");
  keyInput.value = key;

  const valueKindSelect = document.createElement("select");
  const valueKinds = [
    { value: "string", label: "Text" },
    { value: "array", label: "List" },
    { value: "number", label: "Number" },
    { value: "boolean", label: "Boolean" },
  ] as const;
  const initialValueKind = getProfileValueKind(value);

  for (const optionConfig of valueKinds) {
    const option = document.createElement("option");
    option.value = optionConfig.value;
    option.textContent = optionConfig.label;
    option.selected = optionConfig.value === initialValueKind;
    valueKindSelect.append(option);
  }

  const valueInput = document.createElement("input");
  valueInput.value = Array.isArray(value) ? value.join(", ") : String(value);

  const aliasInput = document.createElement("input");
  aliasInput.value = aliases.join(", ");
  aliasInput.placeholder = "Aliases";

  const removeButton = document.createElement("button");
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", onDelete);

  row.append(keyInput, valueKindSelect, valueInput, aliasInput, removeButton);
  row.dataset.key = key;
  row.dataset.value = valueInput.value;
  row.dataset.valueKind = initialValueKind;
  row.dataset.aliases = aliasInput.value;

  keyInput.addEventListener("input", () => {
    row.dataset.key = keyInput.value;
  });

  valueInput.addEventListener("input", () => {
    row.dataset.value = valueInput.value;
  });

  aliasInput.addEventListener("input", () => {
    row.dataset.aliases = aliasInput.value;
  });

  valueKindSelect.addEventListener("change", () => {
    row.dataset.valueKind = valueKindSelect.value;
  });

  return row;
}

function parseValue(raw: string, kind: string | undefined): string | number | boolean | string[] {
  if (kind === "array") {
    return raw.split(",").map((item) => item.trim()).filter(Boolean);
  }

  if (kind === "number") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return raw;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : raw;
  }

  if (kind === "boolean") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  return raw;
}

function updateProfileCardMeta(card: HTMLElement, profile: Profile): void {
  const meta = card.querySelector<HTMLParagraphElement>(".profile-meta");
  if (!meta) {
    return;
  }

  const aliasCount = Object.values(profile.aliases ?? {}).reduce((total, items) => total + items.length, 0);
  meta.textContent = `${Object.keys(profile.values).length} saved value${Object.keys(profile.values).length === 1 ? "" : "s"}${aliasCount > 0 ? ` | ${aliasCount} alias${aliasCount === 1 ? "" : "es"}` : ""}`;
}

function createProfileCard(profile: Profile): HTMLElement {
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.profileId = profile.id;

  const nameInput = document.createElement("input");
  nameInput.value = profile.name;
  nameInput.dataset.role = "profile-name";

  const meta = document.createElement("p");
  meta.className = "profile-meta";
  const aliasCount = Object.values(profile.aliases ?? {}).reduce((total, items) => total + items.length, 0);
  meta.textContent = `${Object.keys(profile.values).length} saved value${Object.keys(profile.values).length === 1 ? "" : "s"}${aliasCount > 0 ? ` | ${aliasCount} alias${aliasCount === 1 ? "" : "es"}` : ""}`;

  const values = document.createElement("div");
  values.className = "profile-values";

  const addValueRow = (key = "", value: string | number | boolean | string[] = "", aliases: string[] = []): void => {
    const row = createProfileValueRow(key, value, aliases, () => row.remove());
    values.append(row);
  };

  for (const [key, value] of Object.entries(profile.values)) {
    addValueRow(key, value, profile.aliases?.[key] ?? []);
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const addEntryButton = document.createElement("button");
  addEntryButton.textContent = "Add field";
  addEntryButton.addEventListener("click", () => addValueRow());

  const saveButton = document.createElement("button");
  saveButton.className = "button accent";
  saveButton.textContent = "Save profile";
  saveButton.addEventListener("click", () => {
    void persistProfile(card, profile).catch((error) => {
      setStatus(error instanceof Error ? error.message : "Unable to save profile.");
    });
  });

  const deleteButton = document.createElement("button");
  deleteButton.textContent = "Delete profile";
  deleteButton.addEventListener("click", () => {
    void deleteProfile(profile.id)
      .then(() => {
        state.profiles = state.profiles.filter((item) => item.id !== profile.id);
        state.history = state.history.map((entry) =>
          entry.lastUsedProfileId === profile.id
            ? {
                ...entry,
                lastUsedProfileId: null,
                lastUsedProfileName: null,
              }
            : entry,
        );
        if (state.settings.defaultProfileId === profile.id) {
          state.settings = {
            ...state.settings,
            defaultProfileId: null,
          };
        }
        renderDefaultProfileOptions();
        renderHistory();
        card.remove();
        if (!state.profiles.length) {
          renderProfiles();
        }
        renderPrivacySummary();
        setStatus(`Deleted profile "${profile.name}".`);
      })
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : "Unable to delete profile.");
      });
  });

  actions.append(addEntryButton, saveButton, deleteButton);
  card.append(nameInput, meta, values, actions);
  return card;
}

function updatePresetCardMeta(card: HTMLElement, preset: FormPreset): void {
  const meta = card.querySelector<HTMLParagraphElement>(".preset-meta");
  if (!meta) {
    return;
  }

  meta.textContent = `${preset.fields.length} field${preset.fields.length === 1 ? "" : "s"} | Updated ${new Date(preset.updatedAt).toLocaleString()}`;
}

function createPresetCard(preset: FormPreset): HTMLElement {
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.presetId = preset.id;

  const titleInput = document.createElement("input");
  titleInput.value = preset.name;

  const meta = document.createElement("p");
  meta.className = "preset-meta";
  meta.textContent = `${preset.fields.length} field${preset.fields.length === 1 ? "" : "s"} | Updated ${new Date(preset.updatedAt).toLocaleString()}`;

  const saveButton = document.createElement("button");
  saveButton.className = "button accent";
  saveButton.textContent = "Rename";
  saveButton.addEventListener("click", async () => {
    try {
      const nextPreset: FormPreset = {
        ...preset,
        name: titleInput.value.trim() || preset.name,
        updatedAt: Date.now(),
      };
      await savePreset(nextPreset);
      const savedPreset =
        (await getPresets()).find((item) => item.formKey === nextPreset.formKey) ??
        nextPreset;
      const presetIndex = state.presets.findIndex(
        (item) =>
          item.id === preset.id ||
          item.id === savedPreset.id ||
          item.formKey === savedPreset.formKey,
      );
      if (presetIndex >= 0) {
        state.presets[presetIndex] = savedPreset;
      }
      Object.assign(preset, savedPreset);
      card.dataset.presetId = savedPreset.id;
      titleInput.value = savedPreset.name;
      updatePresetCardMeta(card, savedPreset);
      setStatus("Updated preset name.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to rename saved form.");
    }
  });

  const deleteButton = document.createElement("button");
  deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => {
        void deletePreset(preset.id)
          .then(() => {
            state.presets = state.presets.filter((item) => item.id !== preset.id);
            card.remove();
            if (!state.presets.length) {
              renderPresets();
            }
            renderPrivacySummary();
            setStatus(`Deleted saved form "${preset.name}".`);
      })
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : "Unable to delete saved form.");
      });
  });

  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(saveButton, deleteButton);

  card.append(titleInput, meta, actions);
  return card;
}

async function persistProfile(card: HTMLElement, profile: Profile): Promise<void> {
  const nameInput = card.querySelector<HTMLInputElement>('[data-role="profile-name"]')!;
  const rows = Array.from(card.querySelectorAll<HTMLElement>(".value-row"));
  const values: Profile["values"] = {};
  const aliases: NonNullable<Profile["aliases"]> = {};

  for (const row of rows) {
    const key = row.dataset.key?.trim();
    if (!key) {
      continue;
    }
    values[key] = parseValue(row.dataset.value ?? "", row.dataset.valueKind);
    const aliasValues = (row.dataset.aliases ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (aliasValues.length > 0) {
      aliases[key] = aliasValues;
    }
  }

  const next: Profile = {
    ...profile,
    name: nameInput.value.trim() || profile.name,
    values,
    aliases,
    updatedAt: Date.now(),
  };

  await saveProfile(next);
  const savedProfile =
    (await getProfiles()).find((item) => item.id === next.id) ?? next;
  const profileIndex = state.profiles.findIndex((item) => item.id === savedProfile.id);
  if (profileIndex >= 0) {
    state.profiles[profileIndex] = savedProfile;
  }
  profile.name = savedProfile.name;
  profile.values = savedProfile.values;
  profile.aliases = savedProfile.aliases;
  profile.updatedAt = savedProfile.updatedAt;
  const refreshedCard = createProfileCard(savedProfile);
  card.replaceWith(refreshedCard);
  renderDefaultProfileOptions();
  renderPrivacySummary();
  setStatus(`Saved profile "${savedProfile.name}".`);
}

function renderProfiles(): void {
  profilesContainer.replaceChildren();

  if (!state.profiles.length) {
    const empty = document.createElement("p");
    empty.className = "profile-meta";
    empty.textContent = "No profiles yet. Add one to map repeated data like name, email, or student ID.";
    profilesContainer.append(empty);
    return;
  }

  for (const profile of state.profiles) {
    profilesContainer.append(createProfileCard(profile));
  }
}

function renderPresets(): void {
  presetsContainer.replaceChildren();

  if (!state.presets.length) {
    const empty = document.createElement("p");
    empty.className = "preset-meta";
    empty.textContent = "No saved forms yet. Forms you review in the popup will be saved automatically.";
    presetsContainer.append(empty);
    return;
  }

  for (const preset of state.presets) {
    presetsContainer.append(createPresetCard(preset));
  }
}

function renderHistory(): void {
  historyContainer?.replaceChildren();
  if (!historyContainer) {
    return;
  }

  if (!state.history.length) {
    const empty = document.createElement("p");
    empty.className = "preset-meta";
    empty.textContent = "No fills recorded yet. Recent forms and profile usage will appear here after a fill run.";
    historyContainer.append(empty);
    return;
  }

  for (const entry of state.history) {
    const card = document.createElement("article");
    card.className = "card";
    const title = document.createElement("p");
    title.className = "history-item-title";
    title.textContent = entry.formTitle;
    const meta = document.createElement("p");
    meta.className = "preset-meta";
    meta.textContent = `Last used ${new Date(entry.lastFilledAt).toLocaleString()}${entry.lastUsedProfileName ? ` with ${entry.lastUsedProfileName}` : ""} | Filled ${entry.filledFieldCount}, skipped ${entry.skippedFieldCount}`;
    card.append(title, meta);
    historyContainer.append(card);
  }
}

function renderPrivacySummary(): void {
  storageSummary?.replaceChildren();
  if (!storageSummary) {
    return;
  }

  for (const line of [
    `${state.profiles.length} profile${state.profiles.length === 1 ? "" : "s"} stored locally`,
    `${state.presets.length} saved form${state.presets.length === 1 ? "" : "s"} stored locally`,
    `${state.history.length} history entr${state.history.length === 1 ? "y" : "ies"} stored locally`,
  ]) {
    const item = document.createElement("p");
    item.className = "preset-meta";
    item.textContent = line;
    storageSummary.append(item);
  }
}

async function refresh(): Promise<void> {
  const [profiles, presets, history, settings] = await Promise.all([getProfiles(), getPresets(), getFormHistory(), getSettings()]);
  state.profiles = profiles;
  state.presets = presets;
  state.history = history;
  state.settings = settings;

  renderDefaultProfileOptions();
  autoLoadCheckbox.checked = settings.autoLoadMatchingProfile;
  confirmBeforeFillCheckbox.checked = settings.confirmBeforeFill;
  showBackupSectionCheckbox.checked = settings.showBackupSection;
  backupSection.classList.toggle("hidden", !settings.showBackupSection);
  renderProfiles();
  renderPresets();
  renderHistory();
  renderPrivacySummary();
}

function syncBackupSectionVisibility(): void {
  backupSection.classList.toggle("hidden", !showBackupSectionCheckbox.checked);
}

async function runTopLevelAction(task: () => Promise<void>, fallbackMessage: string): Promise<void> {
  try {
    await task();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : fallbackMessage);
  }
}

async function persistSettings(): Promise<void> {
  const settings = readSettingsControls();
  await saveSettings(settings);
  const savedSettings = await getSettings();
  state.settings = savedSettings;
  restoreSettingsControls(savedSettings);
}

async function persistSettingsFromControls(): Promise<void> {
  const requestId = ++latestSettingsRequestId;
  settingsSaveQueue = settingsSaveQueue
    .catch(() => undefined)
    .then(async () => {
      try {
        await persistSettings();
        if (requestId !== latestSettingsRequestId) {
          return;
        }
      } catch (error) {
        if (requestId !== latestSettingsRequestId) {
          return;
        }

        const storedSettings = await getSettings();
        restoreSettingsControls(storedSettings);
        setStatus(error instanceof Error ? error.message : "Unable to save settings.");
      }
    });

  await settingsSaveQueue;
}

defaultProfileSelect.addEventListener("change", () => {
  void persistSettingsFromControls();
});

autoLoadCheckbox.addEventListener("change", () => {
  void persistSettingsFromControls();
});

confirmBeforeFillCheckbox.addEventListener("change", () => {
  void persistSettingsFromControls();
});

showBackupSectionCheckbox.addEventListener("change", () => {
  syncBackupSectionVisibility();
  void persistSettingsFromControls();
});

addProfileButton.addEventListener("click", () => {
  void runTopLevelAction(async () => {
    const profile = createEmptyProfile();
    await saveProfile(profile);
    const savedProfile =
      (await getProfiles()).find((item) => item.id === profile.id) ?? profile;
    const existingIndex = state.profiles.findIndex(
      (item) => item.id === savedProfile.id,
    );
    if (existingIndex >= 0) {
      state.profiles[existingIndex] = savedProfile;
    } else {
      state.profiles = [...state.profiles, savedProfile];
    }
    renderDefaultProfileOptions();
    if (state.profiles.length === 1) {
      renderProfiles();
    } else {
      profilesContainer.append(createProfileCard(savedProfile));
    }
    renderPrivacySummary();
    setStatus("Added a new profile.");
  }, "Unable to add profile.");
});

exportButton.addEventListener("click", () => {
  void runTopLevelAction(async () => {
    backupPayload.value = JSON.stringify(await exportAppData(readExportSelectionControls()), null, 2);
    setStatus("Exported local data to the text area.");
  }, "Unable to export local data.");
});

importButton.addEventListener("click", () => {
  void runTopLevelAction(async () => {
    let payload: unknown;

    try {
      payload = JSON.parse(backupPayload.value);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Invalid import payload.");
    }

    if (!isImportedData(payload)) {
      throw new Error("Import payload must be a valid version 1 backup with well-formed profiles, presets, settings, and history.");
    }

    await importAppData(payload, readImportSelectionControls());
    await refresh();
    setStatus("Imported local data.");
  }, "Invalid import payload.");
});

clearDataButton.addEventListener("click", () => {
  void runTopLevelAction(async () => {
    if (!window.confirm("Clear every saved profile, preset, history entry, and setting?")) {
      return;
    }
    await clearAllData();
    backupPayload.value = "";
    await refresh();
    setStatus("Cleared all local data.");
  }, "Unable to clear local data.");
});

clearHistoryButton?.addEventListener("click", () => {
  void runTopLevelAction(async () => {
    await clearHistory();
    await refresh();
    setStatus("Cleared form history.");
  }, "Unable to clear form history.");
});

if (!hasChromeRuntime()) {
  setStatus("Open this page from chrome://extensions or the extension popup.");
} else {
  void refresh().catch((error) => {
    setStatus(error instanceof Error ? error.message : "Failed to load settings");
  });
}

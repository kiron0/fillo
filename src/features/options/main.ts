import { hasChromeRuntime } from "../../core/chrome-api";
import {
  clearAllData,
  deletePreset,
  deleteProfile,
  exportAppData,
  getPresets,
  getProfiles,
  getSettings,
  importAppData,
  saveProfile,
  savePreset,
  saveSettings,
} from "../../core/storage";
import type { AppSettings, FormPreset, ImportedAppData, Profile } from "../../core/types";

const statusNode = document.querySelector<HTMLParagraphElement>("#status")!;
const defaultProfileSelect = document.querySelector<HTMLSelectElement>("#default-profile")!;
const autoLoadCheckbox = document.querySelector<HTMLInputElement>("#auto-load-profile")!;
const confirmBeforeFillCheckbox = document.querySelector<HTMLInputElement>("#confirm-before-fill")!;
const showBackupSectionCheckbox = document.querySelector<HTMLInputElement>("#show-backup-section")!;
const addProfileButton = document.querySelector<HTMLButtonElement>("#add-profile")!;
const profilesContainer = document.querySelector<HTMLDivElement>("#profiles")!;
const presetsContainer = document.querySelector<HTMLDivElement>("#presets")!;
const backupSection = document.querySelector<HTMLDivElement>("#backup-section")!;
const exportButton = document.querySelector<HTMLButtonElement>("#export-data")!;
const importButton = document.querySelector<HTMLButtonElement>("#import-data")!;
const clearDataButton = document.querySelector<HTMLButtonElement>("#clear-data")!;
const backupPayload = document.querySelector<HTMLTextAreaElement>("#backup-payload")!;

const state: {
  profiles: Profile[];
  presets: FormPreset[];
  settings: AppSettings;
} = {
  profiles: [],
  presets: [],
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
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const payload = value as Record<string, unknown>;

  if (!("profiles" in payload) || !Array.isArray(payload.profiles)) {
    return false;
  }

  if (!("presets" in payload) || !Array.isArray(payload.presets)) {
    return false;
  }

  if (!("settings" in payload) || typeof payload.settings !== "object" || payload.settings === null || Array.isArray(payload.settings)) {
    return false;
  }

  return true;
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

function createProfileValueRow(key: string, value: string | number | boolean | string[], onDelete: () => void): HTMLElement {
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

  const removeButton = document.createElement("button");
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", onDelete);

  row.append(keyInput, valueKindSelect, valueInput, removeButton);
  row.dataset.key = key;
  row.dataset.value = valueInput.value;
  row.dataset.valueKind = initialValueKind;

  keyInput.addEventListener("input", () => {
    row.dataset.key = keyInput.value;
  });

  valueInput.addEventListener("input", () => {
    row.dataset.value = valueInput.value;
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

  meta.textContent = `${Object.keys(profile.values).length} saved value${Object.keys(profile.values).length === 1 ? "" : "s"}`;
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
  meta.textContent = `${Object.keys(profile.values).length} saved value${Object.keys(profile.values).length === 1 ? "" : "s"}`;

  const values = document.createElement("div");
  values.className = "profile-values";

  const addValueRow = (key = "", value: string | number | boolean | string[] = ""): void => {
    const row = createProfileValueRow(key, value, () => row.remove());
    values.append(row);
  };

  for (const [key, value] of Object.entries(profile.values)) {
    addValueRow(key, value);
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
        if (state.settings.defaultProfileId === profile.id) {
          state.settings = {
            ...state.settings,
            defaultProfileId: null,
          };
        }
        renderDefaultProfileOptions();
        card.remove();
        if (!state.profiles.length) {
          renderProfiles();
        }
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
      const presetIndex = state.presets.findIndex((item) => item.id === nextPreset.id);
      if (presetIndex >= 0) {
        state.presets[presetIndex] = nextPreset;
      }
      preset.name = nextPreset.name;
      preset.updatedAt = nextPreset.updatedAt;
      titleInput.value = nextPreset.name;
      updatePresetCardMeta(card, nextPreset);
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

  for (const row of rows) {
    const key = row.dataset.key?.trim();
    if (!key) {
      continue;
    }
    values[key] = parseValue(row.dataset.value ?? "", row.dataset.valueKind);
  }

  const next: Profile = {
    ...profile,
    name: nameInput.value.trim() || profile.name,
    values,
    updatedAt: Date.now(),
  };

  await saveProfile(next);
  const profileIndex = state.profiles.findIndex((item) => item.id === next.id);
  if (profileIndex >= 0) {
    state.profiles[profileIndex] = next;
  }
  profile.name = next.name;
  profile.values = next.values;
  profile.updatedAt = next.updatedAt;
  nameInput.value = next.name;
  updateProfileCardMeta(card, next);
  renderDefaultProfileOptions();
  setStatus(`Saved profile "${next.name}".`);
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

async function refresh(): Promise<void> {
  const [profiles, presets, settings] = await Promise.all([getProfiles(), getPresets(), getSettings()]);
  state.profiles = profiles;
  state.presets = presets;
  state.settings = settings;

  renderDefaultProfileOptions();
  autoLoadCheckbox.checked = settings.autoLoadMatchingProfile;
  confirmBeforeFillCheckbox.checked = settings.confirmBeforeFill;
  showBackupSectionCheckbox.checked = settings.showBackupSection;
  backupSection.classList.toggle("hidden", !settings.showBackupSection);
  renderProfiles();
  renderPresets();
}

function syncBackupSectionVisibility(): void {
  backupSection.classList.toggle("hidden", !showBackupSectionCheckbox.checked);
}

async function persistSettings(): Promise<void> {
  const settings = readSettingsControls();
  await saveSettings(settings);
  state.settings = settings;
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

addProfileButton.addEventListener("click", async () => {
  const profile = createEmptyProfile();
  await saveProfile(profile);
  if (!state.profiles.some((item) => item.id === profile.id)) {
    state.profiles = [...state.profiles, profile];
  }
  renderDefaultProfileOptions();
  if (state.profiles.length === 1) {
    renderProfiles();
  } else {
    profilesContainer.append(createProfileCard(profile));
  }
  setStatus("Added a new profile.");
});

exportButton.addEventListener("click", async () => {
  backupPayload.value = JSON.stringify(await exportAppData(), null, 2);
  setStatus("Exported local data to the text area.");
});

importButton.addEventListener("click", async () => {
  try {
    const payload = JSON.parse(backupPayload.value);
    if (!isImportedData(payload)) {
      throw new Error("Import payload must include profiles, presets, and settings.");
    }

    await importAppData(payload);
    await refresh();
    setStatus("Imported local data.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Invalid import payload.");
  }
});

clearDataButton.addEventListener("click", async () => {
  if (!window.confirm("Clear every saved profile, preset, and setting?")) {
    return;
  }
  await clearAllData();
  backupPayload.value = "";
  await refresh();
  setStatus("Cleared all local data.");
});

if (!hasChromeRuntime()) {
  setStatus("Open this page from chrome://extensions or the extension popup.");
} else {
  void refresh().catch((error) => {
    setStatus(error instanceof Error ? error.message : "Failed to load settings");
  });
}

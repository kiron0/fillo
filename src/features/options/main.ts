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
  saveSettings,
} from "../../core/storage";
import type { AppSettings, FormPreset, ImportedAppData, Profile } from "../../core/types";

const statusNode = document.querySelector<HTMLParagraphElement>("#status")!;
const defaultProfileSelect = document.querySelector<HTMLSelectElement>("#default-profile")!;
const autoLoadCheckbox = document.querySelector<HTMLInputElement>("#auto-load-profile")!;
const confirmBeforeFillCheckbox = document.querySelector<HTMLInputElement>("#confirm-before-fill")!;
const saveSettingsButton = document.querySelector<HTMLButtonElement>("#save-settings")!;
const addProfileButton = document.querySelector<HTMLButtonElement>("#add-profile")!;
const profilesContainer = document.querySelector<HTMLDivElement>("#profiles")!;
const presetsContainer = document.querySelector<HTMLDivElement>("#presets")!;
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
  },
};

function setStatus(message: string): void {
  statusNode.textContent = message;
}

function isImportedData(value: unknown): value is ImportedAppData {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const payload = value as Record<string, unknown>;

  if ("profiles" in payload && !Array.isArray(payload.profiles)) {
    return false;
  }

  if ("presets" in payload && !Array.isArray(payload.presets)) {
    return false;
  }

  if ("settings" in payload && (typeof payload.settings !== "object" || payload.settings === null || Array.isArray(payload.settings))) {
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

  const valueInput = document.createElement("input");
  valueInput.value = Array.isArray(value) ? value.join(", ") : String(value);

  const removeButton = document.createElement("button");
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", onDelete);

  row.append(keyInput, valueInput, removeButton);
  row.dataset.key = key;
  row.dataset.value = valueInput.value;

  keyInput.addEventListener("input", () => {
    row.dataset.key = keyInput.value;
  });

  valueInput.addEventListener("input", () => {
    row.dataset.value = valueInput.value;
  });

  return row;
}

function parseValue(raw: string): string | string[] {
  return raw.includes(",") ? raw.split(",").map((item) => item.trim()).filter(Boolean) : raw;
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
    values[key] = parseValue(row.dataset.value ?? "");
  }

  const next: Profile = {
    ...profile,
    name: nameInput.value.trim() || profile.name,
    values,
    updatedAt: Date.now(),
  };

  await saveProfile(next);
  await refresh();
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
    const card = document.createElement("article");
    card.className = "card";

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
      void persistProfile(card, profile);
    });

    const deleteButton = document.createElement("button");
    deleteButton.textContent = "Delete profile";
    deleteButton.addEventListener("click", () => {
      void deleteProfile(profile.id).then(refresh);
    });

    actions.append(addEntryButton, saveButton, deleteButton);
    card.append(nameInput, meta, values, actions);
    profilesContainer.append(card);
  }
}

function renderPresets(): void {
  presetsContainer.replaceChildren();

  if (!state.presets.length) {
    const empty = document.createElement("p");
    empty.className = "preset-meta";
    empty.textContent = "No saved forms yet. Save a preset from the popup after scanning a Google Form.";
    presetsContainer.append(empty);
    return;
  }

  for (const preset of state.presets) {
    const card = document.createElement("article");
    card.className = "card";

    const titleInput = document.createElement("input");
    titleInput.value = preset.name;

    const meta = document.createElement("p");
    meta.className = "preset-meta";
    meta.textContent = `${preset.fields.length} field${preset.fields.length === 1 ? "" : "s"} • Updated ${new Date(preset.updatedAt).toLocaleString()}`;

    const saveButton = document.createElement("button");
    saveButton.className = "button accent";
    saveButton.textContent = "Rename";
    saveButton.addEventListener("click", async () => {
      await importAppData({
        ...(await exportAppData()),
        presets: state.presets.map((item) => (item.id === preset.id ? { ...item, name: titleInput.value.trim() || item.name } : item)),
      });
      await refresh();
      setStatus("Updated preset name.");
    });

    const deleteButton = document.createElement("button");
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => {
      void deletePreset(preset.id).then(refresh);
    });

    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.append(saveButton, deleteButton);

    card.append(titleInput, meta, actions);
    presetsContainer.append(card);
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
  renderProfiles();
  renderPresets();
}

saveSettingsButton.addEventListener("click", async () => {
  await saveSettings({
    defaultProfileId: defaultProfileSelect.value || null,
    autoLoadMatchingProfile: autoLoadCheckbox.checked,
    confirmBeforeFill: confirmBeforeFillCheckbox.checked,
  });
  await refresh();
  setStatus("Saved settings.");
});

addProfileButton.addEventListener("click", async () => {
  await saveProfile(createEmptyProfile());
  await refresh();
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
      throw new Error("Import payload must be a JSON object.");
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

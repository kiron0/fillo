import type { AppSettings, ExportedAppData, FormPreset, ImportedAppData, Profile } from "./types";
import { storageGet, storageRemove, storageSet } from "./chrome-api";
import { DEFAULT_SETTINGS } from "./types";

const STORAGE_KEYS = {
  profiles: "profiles",
  presets: "presets",
  settings: "settings",
} as const;

type StorageShape = {
  [STORAGE_KEYS.profiles]?: Profile[];
  [STORAGE_KEYS.presets]?: FormPreset[];
  [STORAGE_KEYS.settings]?: AppSettings;
};

type StorageKeyName = keyof typeof STORAGE_KEYS;
type StorageLock = {
  token: string;
  expiresAt: number;
};

const STORAGE_LOCK_PREFIX = "__lock__";
const LOCK_RETRY_MS = 25;
const LOCK_TTL_MS = 5_000;
const LOCK_TIMEOUT_MS = LOCK_TTL_MS + 1_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createLockToken(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function getLockKey(name: StorageKeyName): string {
  return `${STORAGE_LOCK_PREFIX}${name}`;
}

async function readLock(name: StorageKeyName): Promise<StorageLock | null> {
  const lockKey = getLockKey(name);
  const result = await storageGet<Record<string, unknown>>([lockKey]);
  const value = result[lockKey];
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const token = "token" in value ? value.token : undefined;
  const expiresAt = "expiresAt" in value ? value.expiresAt : undefined;
  return typeof token === "string" && typeof expiresAt === "number"
    ? { token, expiresAt }
    : null;
}

async function acquireLock(name: StorageKeyName): Promise<string> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  const token = createLockToken();
  const lockKey = getLockKey(name);

  while (Date.now() < deadline) {
    const currentLock = await readLock(name);
    if (!currentLock || currentLock.expiresAt <= Date.now()) {
      await storageSet({
        [lockKey]: {
          token,
          expiresAt: Date.now() + LOCK_TTL_MS,
        },
      });

      const confirmedLock = await readLock(name);
      if (confirmedLock?.token === token) {
        return token;
      }
    }

    await wait(LOCK_RETRY_MS);
  }

  throw new Error(`Unable to acquire storage lock for ${name}.`);
}

async function releaseLock(name: StorageKeyName, token: string): Promise<void> {
  const currentLock = await readLock(name);
  if (currentLock?.token === token) {
    await storageRemove([getLockKey(name)]);
  }
}

async function withStorageLocks<T>(names: StorageKeyName[], action: () => Promise<T>): Promise<T> {
  const tokens = new Map<StorageKeyName, string>();
  const sortedNames = [...new Set(names)].sort();

  try {
    for (const name of sortedNames) {
      tokens.set(name, await acquireLock(name));
    }

    return await action();
  } finally {
    for (const name of [...sortedNames].reverse()) {
      const token = tokens.get(name);
      if (token) {
        await releaseLock(name, token);
      }
    }
  }
}

async function readProfiles(): Promise<Profile[]> {
  const result = await storageGet<StorageShape>([STORAGE_KEYS.profiles]);
  return Array.isArray(result.profiles) ? result.profiles : [];
}

async function readPresets(): Promise<FormPreset[]> {
  const result = await storageGet<StorageShape>([STORAGE_KEYS.presets]);
  return Array.isArray(result.presets) ? result.presets : [];
}

async function readSettings(): Promise<AppSettings> {
  const result = await storageGet<StorageShape>([STORAGE_KEYS.settings]);
  return { ...DEFAULT_SETTINGS, ...(result.settings ?? {}) };
}

async function readAll(): Promise<Required<StorageShape>> {
  const result = await storageGet<StorageShape>(Object.values(STORAGE_KEYS));
  return {
    profiles: Array.isArray(result.profiles) ? result.profiles : [],
    presets: Array.isArray(result.presets) ? result.presets : [],
    settings: { ...DEFAULT_SETTINGS, ...(result.settings ?? {}) },
  };
}

async function writeAll(data: Required<StorageShape>): Promise<void> {
  await storageSet(data);
}

export async function getProfiles(): Promise<Profile[]> {
  return readProfiles();
}

export async function saveProfile(profile: Profile): Promise<void> {
  await withStorageLocks(["profiles"], async () => {
    const profiles = await readProfiles();
    const existingIndex = profiles.findIndex((item) => item.id === profile.id);

    if (existingIndex >= 0) {
      profiles[existingIndex] = profile;
    } else {
      profiles.push(profile);
    }

    await storageSet({ [STORAGE_KEYS.profiles]: profiles });
  });
}

export async function deleteProfile(profileId: string): Promise<void> {
  await withStorageLocks(["profiles", "settings"], async () => {
    const [profiles, settings] = await Promise.all([readProfiles(), readSettings()]);
    const nextProfiles = profiles.filter((item) => item.id !== profileId);
    const nextState: StorageShape = {
      [STORAGE_KEYS.profiles]: nextProfiles,
    };

    if (settings.defaultProfileId === profileId) {
      nextState[STORAGE_KEYS.settings] = {
        ...settings,
        defaultProfileId: null,
      };
    }

    await storageSet(nextState);
  });
}

export async function getPresets(): Promise<FormPreset[]> {
  return readPresets();
}

export async function getPresetByFormKey(formKey: string): Promise<FormPreset | null> {
  return (await readPresets()).find((item) => item.formKey === formKey) ?? null;
}

export async function savePreset(preset: FormPreset): Promise<void> {
  await withStorageLocks(["presets"], async () => {
    const presets = await readPresets();
    const existingIndex = presets.findIndex((item) => item.id === preset.id || item.formKey === preset.formKey);

    if (existingIndex >= 0) {
      presets[existingIndex] = preset;
    } else {
      presets.push(preset);
    }

    await storageSet({ [STORAGE_KEYS.presets]: presets });
  });
}

export async function deletePreset(presetId: string): Promise<void> {
  await withStorageLocks(["presets"], async () => {
    const presets = await readPresets();
    await storageSet({
      [STORAGE_KEYS.presets]: presets.filter((item) => item.id !== presetId),
    });
  });
}

export async function getSettings(): Promise<AppSettings> {
  return readSettings();
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await withStorageLocks(["settings"], async () => {
    await storageSet({ [STORAGE_KEYS.settings]: settings });
  });
}

export async function clearAllData(): Promise<void> {
  await withStorageLocks(["profiles", "presets", "settings"], async () => {
    await writeAll({
      profiles: [],
      presets: [],
      settings: DEFAULT_SETTINGS,
    });
  });
}

export async function exportAppData(): Promise<ExportedAppData> {
  const data = await readAll();
  return {
    version: 1,
    exportedAt: Date.now(),
    profiles: data.profiles,
    presets: data.presets,
    settings: data.settings,
  };
}

export async function importAppData(payload: ImportedAppData): Promise<void> {
  if (!Array.isArray(payload.profiles) || !Array.isArray(payload.presets) || typeof payload.settings !== "object" || payload.settings === null) {
    throw new Error("Import payload must include profiles, presets, and settings.");
  }

  await withStorageLocks(["profiles", "presets", "settings"], async () => {
    await writeAll({
      profiles: payload.profiles,
      presets: payload.presets,
      settings: { ...DEFAULT_SETTINGS, ...payload.settings },
    });
  });
}

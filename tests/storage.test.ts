import {
  clearAllData,
  exportAppData,
  getPresetByFormKey,
  getProfiles,
  getSettings,
  importAppData,
  savePreset,
  saveProfile,
  saveSettings,
} from "../src/core/storage";
import type { FormPreset, Profile } from "../src/core/types";

function createStorageMock() {
  const state: Record<string, unknown> = {};
  let queue = Promise.resolve();

  return {
    state,
    storage: {
      local: {
        get(keys: string[], callback: (result: Record<string, unknown>) => void) {
          callback(Object.fromEntries(keys.map((key) => [key, state[key]])));
        },
        set(value: Record<string, unknown>, callback: () => void) {
          Object.assign(state, value);
          callback();
        },
        remove(keys: string[], callback: () => void) {
          for (const key of keys) {
            delete state[key];
          }
          callback();
        },
      },
    },
    runtime: {
      sendMessage(
        message: {
          type: string;
          payload?:
            | { kind: "save_profile"; profile: Profile }
            | { kind: "save_preset"; preset: FormPreset }
            | { kind: "delete_profile"; profileId: string }
            | { kind: "delete_preset"; presetId: string }
            | {
                kind: "save_settings";
                settings: {
                  defaultProfileId: string | null;
                  autoLoadMatchingProfile: boolean;
                  confirmBeforeFill: boolean;
                  showBackupSection: boolean;
                };
              }
            | { kind: "clear_all_data" }
            | {
                kind: "import_app_data";
                data: {
                  profiles?: Profile[];
                  presets?: FormPreset[];
                  settings?: Record<string, unknown>;
                };
              };
        },
        callback: (response: unknown) => void,
      ) {
        if (message.type !== "RUN_STORAGE_MUTATION" || !message.payload) {
          callback({ ok: false, error: "Unknown message" });
          return;
        }

        const run = queue.then(async () => {
          switch (message.payload.kind) {
            case "save_profile": {
              const profiles = Array.isArray(state.profiles) ? ([...state.profiles] as Profile[]) : [];
              const existingIndex = profiles.findIndex((item) => item.id === message.payload.profile.id);
              if (existingIndex >= 0) {
                profiles[existingIndex] = message.payload.profile;
              } else {
                profiles.push(message.payload.profile);
              }
              state.profiles = profiles;
              callback({ ok: true, data: null });
              return;
            }
            case "save_preset": {
              const presets = Array.isArray(state.presets) ? ([...state.presets] as FormPreset[]) : [];
              const existingIndex = presets.findIndex(
                (item) => item.id === message.payload.preset.id || item.formKey === message.payload.preset.formKey,
              );
              if (existingIndex >= 0) {
                presets[existingIndex] = message.payload.preset;
              } else {
                presets.push(message.payload.preset);
              }
              state.presets = presets;
              callback({ ok: true, data: null });
              return;
            }
            case "delete_profile": {
              const profiles = Array.isArray(state.profiles) ? ([...state.profiles] as Profile[]) : [];
              state.profiles = profiles.filter((item) => item.id !== message.payload.profileId);
              const settings = (state.settings ?? {
                defaultProfileId: null,
                autoLoadMatchingProfile: true,
                confirmBeforeFill: true,
                showBackupSection: false,
              }) as Record<string, unknown>;
              if (settings.defaultProfileId === message.payload.profileId) {
                state.settings = {
                  ...settings,
                  defaultProfileId: null,
                };
              }
              callback({ ok: true, data: null });
              return;
            }
            case "delete_preset": {
              const presets = Array.isArray(state.presets) ? ([...state.presets] as FormPreset[]) : [];
              state.presets = presets.filter((item) => item.id !== message.payload.presetId);
              callback({ ok: true, data: null });
              return;
            }
            case "save_settings":
              state.settings = message.payload.settings;
              callback({ ok: true, data: null });
              return;
            case "clear_all_data":
              state.profiles = [];
              state.presets = [];
              state.settings = {
                defaultProfileId: null,
                autoLoadMatchingProfile: true,
                confirmBeforeFill: true,
                showBackupSection: false,
              };
              callback({ ok: true, data: null });
              return;
            case "import_app_data":
              state.profiles = message.payload.data.profiles ?? [];
              state.presets = message.payload.data.presets ?? [];
              state.settings = {
                defaultProfileId: null,
                autoLoadMatchingProfile: true,
                confirmBeforeFill: true,
                showBackupSection: false,
                ...(message.payload.data.settings ?? {}),
              };
              callback({ ok: true, data: null });
              return;
            default:
              callback({ ok: false, error: "Unsupported mutation" });
          }
        });

        queue = run.then(
          () => undefined,
          () => undefined,
        );
      },
    },
  };
}

function createNavigatorLocksMock() {
  let queue = Promise.resolve();

  return {
    locks: {
      request: vi.fn(async (_name: string, callback: () => Promise<unknown>) => {
        const run = queue.then(() => callback());
        queue = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      }),
    },
  };
}

describe("storage", () => {
  beforeEach(() => {
    const mock = createStorageMock();
    vi.stubGlobal("chrome", mock);
    vi.stubGlobal("navigator", createNavigatorLocksMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists profiles, presets, and settings locally", async () => {
    const profile: Profile = {
      id: "profile-1",
      name: "Personal",
      values: { fullName: "Toufiq Hasan" },
      createdAt: 1,
      updatedAt: 1,
    };

    const preset: FormPreset = {
      id: "preset-1",
      name: "Hackathon Registration",
      formKey: "form-1",
      formTitle: "Hackathon",
      fields: [],
      values: { fullName: "Toufiq Hasan" },
      createdAt: 1,
      updatedAt: 1,
    };

    await saveProfile(profile);
    await savePreset(preset);
    await saveSettings({
      defaultProfileId: "profile-1",
      autoLoadMatchingProfile: false,
      confirmBeforeFill: true,
      showBackupSection: false,
    });

    expect(await getProfiles()).toEqual([profile]);
    expect(await getPresetByFormKey("form-1")).toEqual(preset);
    expect(await getSettings()).toEqual({
      defaultProfileId: "profile-1",
      autoLoadMatchingProfile: false,
      confirmBeforeFill: true,
      showBackupSection: false,
    });
  });

  it("exports and clears all data", async () => {
    await saveProfile({
      id: "profile-1",
      name: "Personal",
      values: { email: "toufiq@example.com" },
      createdAt: 1,
      updatedAt: 1,
    });

    expect((await exportAppData()).profiles).toHaveLength(1);
    await clearAllData();
    expect((await exportAppData()).profiles).toHaveLength(0);
  });

  it("rejects incomplete import payloads without clearing existing data", async () => {
    await saveProfile({
      id: "profile-1",
      name: "Personal",
      values: { email: "toufiq@example.com" },
      createdAt: 1,
      updatedAt: 1,
    });

    await expect(importAppData({})).rejects.toThrow("Import payload must include profiles, presets, and settings.");
    expect(await getProfiles()).toEqual([
      {
        id: "profile-1",
        name: "Personal",
        values: { email: "toufiq@example.com" },
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
  });

  it("keeps concurrent preset saves from overwriting each other", async () => {
    const presetA: FormPreset = {
      id: "preset-a",
      name: "Form A",
      formKey: "form-a",
      formTitle: "Form A",
      fields: [],
      values: { fieldA: "Alpha" },
      createdAt: 1,
      updatedAt: 1,
    };

    const presetB: FormPreset = {
      id: "preset-b",
      name: "Form B",
      formKey: "form-b",
      formTitle: "Form B",
      fields: [],
      values: { fieldB: "Beta" },
      createdAt: 1,
      updatedAt: 1,
    };

    await Promise.all([savePreset(presetA), savePreset(presetB)]);

    const exported = await exportAppData();
    expect(exported.presets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "preset-a", formKey: "form-a" }),
        expect.objectContaining({ id: "preset-b", formKey: "form-b" }),
      ]),
    );
    expect(exported.presets).toHaveLength(2);
  });

  it("uses the browser lock manager when available", async () => {
    const navigatorWithLocks = {
      locks: {
        request: vi.fn(async (_name: string, callback: () => Promise<unknown>) => callback()),
      },
    };

    vi.stubGlobal("navigator", navigatorWithLocks);

    const preset: FormPreset = {
      id: "preset-1",
      name: "Locked Form",
      formKey: "locked-form",
      formTitle: "Locked Form",
      fields: [],
      values: { fullName: "Toufiq Hasan" },
      createdAt: 1,
      updatedAt: 1,
    };

    await savePreset(preset);

    expect(navigatorWithLocks.locks.request).toHaveBeenCalledTimes(1);
    expect(navigatorWithLocks.locks.request).toHaveBeenCalledWith("fillo-storage-write", expect.any(Function));
  });

  it("falls back to background-serialized writes when the Web Locks API is unavailable", async () => {
    vi.stubGlobal("navigator", {});

    const preset: FormPreset = {
      id: "preset-1",
      name: "Locked Form",
      formKey: "locked-form",
      formTitle: "Locked Form",
      fields: [],
      values: { fullName: "Toufiq Hasan" },
      createdAt: 1,
      updatedAt: 1,
    };

    await savePreset(preset);

    expect(await getPresetByFormKey("locked-form")).toEqual(preset);
  });

  it("keeps real __no_mapping__ profile keys intact in stored presets", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.presets = [
      {
        id: "preset-1",
        name: "Registration",
        formKey: "form-1",
        formTitle: "Registration",
        fields: [],
        values: {},
        mappings: {
          email: "__no_mapping__",
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ] satisfies FormPreset[];

    expect(await getPresetByFormKey("form-1")).toEqual({
      id: "preset-1",
      name: "Registration",
      formKey: "form-1",
      formTitle: "Registration",
      fields: [],
      values: {},
      mappings: {
        email: "__no_mapping__",
      },
      createdAt: 1,
      updatedAt: 1,
    });
  });
});

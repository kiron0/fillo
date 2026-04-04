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
    runtime: {},
  };
}

describe("storage", () => {
  beforeEach(() => {
    const mock = createStorageMock();
    vi.stubGlobal("chrome", mock);
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
});

import {
  clearAllData,
  deleteProfile,
  exportAppData,
  getFormHistory,
  getPresetByFormKey,
  getProfiles,
  getSettings,
  importAppData,
  saveHistoryEntry,
  savePreset,
  saveProfile,
  saveSettings,
} from "../src/core/storage";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BackgroundRequest, FormPreset, Profile } from "../src/core/types";

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
        message: BackgroundRequest,
        callback: (response: unknown) => void,
      ) {
        if (message.type !== "RUN_STORAGE_MUTATION") {
          callback({ ok: false, error: "Unknown message" });
          return;
        }

        const payload = message.payload;
        const run = queue.then(async () => {
          switch (payload.kind) {
            case "save_profile": {
              const profiles = Array.isArray(state.profiles) ? ([...state.profiles] as Profile[]) : [];
              const existingIndex = profiles.findIndex((item) => item.id === payload.profile.id);
              if (existingIndex >= 0) {
                profiles[existingIndex] = payload.profile;
              } else {
                profiles.push(payload.profile);
              }
              state.profiles = profiles;
              callback({ ok: true, data: null });
              return;
            }
            case "save_preset": {
              const presets = Array.isArray(state.presets) ? ([...state.presets] as FormPreset[]) : [];
              const existingIndex = presets.findIndex(
                (item) => item.id === payload.preset.id || item.formKey === payload.preset.formKey,
              );
              if (existingIndex >= 0) {
                presets[existingIndex] = payload.preset;
              } else {
                presets.push(payload.preset);
              }
              state.presets = presets;
              callback({ ok: true, data: null });
              return;
            }
            case "delete_profile": {
              const profiles = Array.isArray(state.profiles) ? ([...state.profiles] as Profile[]) : [];
              state.profiles = profiles.filter((item) => item.id !== payload.profileId);
              const settings = (state.settings ?? {
                defaultProfileId: null,
                autoLoadMatchingProfile: true,
                confirmBeforeFill: true,
                showBackupSection: false,
              }) as Record<string, unknown>;
              if (settings.defaultProfileId === payload.profileId) {
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
              state.presets = presets.filter((item) => item.id !== payload.presetId);
              callback({ ok: true, data: null });
              return;
            }
            case "save_settings":
              state.settings = payload.settings;
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
              state.profiles = payload.data.profiles ?? [];
              state.presets = payload.data.presets ?? [];
              state.settings = {
                defaultProfileId: null,
                autoLoadMatchingProfile: true,
                confirmBeforeFill: true,
                showBackupSection: false,
                ...(payload.data.settings ?? {}),
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

  it("falls back to background mutations when navigator.locks is present without a request function", async () => {
    vi.stubGlobal("navigator", { locks: {} });

    await saveProfile({
      id: "profile-1",
      name: "Personal",
      values: { email: "toufiq@example.com" },
      createdAt: 1,
      updatedAt: 1,
    });

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

  it("falls back to background mutations when navigator.locks.request throws synchronously", async () => {
    vi.stubGlobal("navigator", {
      locks: {
        request() {
          throw new Error("locks failed");
        },
      },
    });

    await saveProfile({
      id: "profile-1",
      name: "Personal",
      values: { email: "toufiq@example.com" },
      createdAt: 1,
      updatedAt: 1,
    });

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

  it("falls back to background mutations when navigator.locks.request rejects before starting the action", async () => {
    vi.stubGlobal("navigator", {
      locks: {
        request() {
          return Promise.reject(new Error("locks failed"));
        },
      },
    });

    await saveProfile({
      id: "profile-1",
      name: "Personal",
      values: { email: "toufiq@example.com" },
      createdAt: 1,
      updatedAt: 1,
    });

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

    await expect(importAppData({})).rejects.toThrow("Import payload must be a version 1 backup.");
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

  it("rejects backups with an unsupported version", async () => {
    await expect(
      importAppData({
        version: 2,
        profiles: [],
        presets: [],
        settings: {
          defaultProfileId: null,
          autoLoadMatchingProfile: true,
          confirmBeforeFill: true,
          showBackupSection: false,
        },
      }),
    ).rejects.toThrow("Import payload must be a version 1 backup.");
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

  it("migrates legacy __no_mapping__ sentinels into unmappedFieldIds", async () => {
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
      unmappedFieldIds: ["email"],
      createdAt: 1,
      updatedAt: 1,
    });
  });

  it("keeps real __no_mapping__ profile keys intact in schema version 2 presets", async () => {
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
        mappingSchemaVersion: 2,
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
      mappingSchemaVersion: 2,
      createdAt: 1,
      updatedAt: 1,
    });
  });

  it("drops explicit unmapped entries when the same field also has a saved mapping", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.presets = [
      {
        id: "preset-1",
        name: "Registration",
        formKey: "form-1",
        formTitle: "Registration",
        fields: [
          {
            id: "email",
            label: "Email",
            normalizedLabel: "email",
            type: "text",
            required: true,
          },
        ],
        values: {},
        mappings: {
          email: "email",
        },
        unmappedFieldIds: ["email"],
        mappingSchemaVersion: 2,
        createdAt: 1,
        updatedAt: 1,
      },
    ] satisfies FormPreset[];

    expect(await getPresetByFormKey("form-1")).toEqual({
      id: "preset-1",
      name: "Registration",
      formKey: "form-1",
      formTitle: "Registration",
      fields: [
        {
          id: "email",
          label: "Email",
          normalizedLabel: "email",
          type: "text",
          required: true,
        },
      ],
      values: {},
      mappings: {
        email: "email",
      },
      mappingSchemaVersion: 2,
      createdAt: 1,
      updatedAt: 1,
    });
  });

  it("normalizes imported history to the newest 25 entries", async () => {
    const history = Array.from({ length: 30 }, (_, index) => ({
      id: `history-${index + 1}`,
      formKey: `form-${index + 1}`,
      formTitle: `Form ${index + 1}`,
      lastUsedProfileId: null,
      lastFilledAt: index + 1,
      filledFieldCount: 1,
      skippedFieldCount: 0,
    }));

    await importAppData({
      version: 1,
      profiles: [],
      presets: [],
      settings: {
        defaultProfileId: null,
        autoLoadMatchingProfile: true,
        confirmBeforeFill: true,
        showBackupSection: false,
      },
      history,
    });

    const exported = await exportAppData();
    expect(exported.history).toHaveLength(25);
    expect(exported.history?.[0]?.id).toBe("history-30");
    expect(exported.history?.[24]?.id).toBe("history-6");
  });

  it("deduplicates stored history by form key and keeps the newest entry", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.history = [
      {
        id: "history-old",
        formKey: "form-1",
        formTitle: "Form 1",
        lastUsedProfileId: "profile-1",
        lastFilledAt: 1,
        filledFieldCount: 1,
        skippedFieldCount: 0,
      },
      {
        id: "history-new",
        formKey: "form-1",
        formTitle: "Form 1",
        lastUsedProfileId: "profile-2",
        lastFilledAt: 2,
        filledFieldCount: 2,
        skippedFieldCount: 1,
      },
      {
        id: "history-other",
        formKey: "form-2",
        formTitle: "Form 2",
        lastUsedProfileId: null,
        lastFilledAt: 3,
        filledFieldCount: 1,
        skippedFieldCount: 0,
      },
    ];

    expect(await getFormHistory()).toEqual([
      {
        id: "history-other",
        formKey: "form-2",
        formTitle: "Form 2",
        lastUsedProfileId: null,
        lastUsedProfileName: null,
        lastFilledAt: 3,
        filledFieldCount: 1,
        skippedFieldCount: 0,
      },
      {
        id: "history-new",
        formKey: "form-1",
        formTitle: "Form 1",
        lastUsedProfileId: null,
        lastUsedProfileName: null,
        lastFilledAt: 2,
        filledFieldCount: 2,
        skippedFieldCount: 1,
      },
    ]);
  });

  it("prefers later duplicates when preset/profile/history timestamps are equal", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.profiles = [
      {
        id: "profile-1",
        name: "First Profile",
        values: { fullName: "Old" },
        createdAt: 1,
        updatedAt: 10,
      },
      {
        id: "profile-1",
        name: "Second Profile",
        values: { fullName: "New" },
        createdAt: 1,
        updatedAt: 10,
      },
    ];
    chromeWithState.state.presets = [
      {
        id: "preset-1",
        name: "First Preset",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [{ id: "full_name", label: "Full Name", normalizedLabel: "full name", type: "text", required: true }],
        values: { full_name: "Old" },
        createdAt: 1,
        updatedAt: 10,
      },
      {
        id: "preset-2",
        name: "Second Preset",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [{ id: "full_name", label: "Full Name", normalizedLabel: "full name", type: "text", required: true }],
        values: { full_name: "New" },
        createdAt: 1,
        updatedAt: 10,
      },
    ];
    chromeWithState.state.history = [
      {
        id: "history-1",
        formKey: "form-1",
        formTitle: "Form 1",
        lastUsedProfileId: "profile-1",
        lastFilledAt: 10,
        filledFieldCount: 1,
        skippedFieldCount: 0,
      },
      {
        id: "history-2",
        formKey: "form-1",
        formTitle: "Form 1",
        lastUsedProfileId: "profile-2",
        lastFilledAt: 10,
        filledFieldCount: 2,
        skippedFieldCount: 0,
      },
    ];

    expect(await getProfiles()).toEqual([
      {
        id: "profile-1",
        name: "Second Profile",
        values: { fullName: "New" },
        createdAt: 1,
        updatedAt: 10,
      },
    ]);
    expect(await getPresetByFormKey("form-1")).toEqual({
      id: "preset-2",
      name: "Second Preset",
      formKey: "form-1",
      formTitle: "Form 1",
      fields: [{ id: "full_name", label: "Full Name", normalizedLabel: "full name", type: "text", required: true }],
      values: { full_name: "New" },
      createdAt: 1,
      updatedAt: 10,
    });
    expect(await getFormHistory()).toEqual([
      {
        id: "history-2",
        formKey: "form-1",
        formTitle: "Form 1",
        lastUsedProfileId: null,
        lastUsedProfileName: null,
        lastFilledAt: 10,
        filledFieldCount: 2,
        skippedFieldCount: 0,
      },
    ]);
  });

  it("rejects imported presets with invalid field grid metadata", async () => {
    await expect(
      importAppData({
        version: 1,
        profiles: [],
        presets: [
          {
            id: "preset-1",
            name: "Invalid Grid Preset",
            formKey: "form-1",
            formTitle: "Invalid Grid",
            fields: [
              {
                id: "availability",
                label: "Availability",
                normalizedLabel: "availability",
                type: "grid",
                required: false,
                gridRows: ["Morning", 2] as unknown as string[],
              },
            ],
            values: {},
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        settings: {
          defaultProfileId: null,
          autoLoadMatchingProfile: true,
          confirmBeforeFill: true,
          showBackupSection: false,
        },
      }),
    ).rejects.toThrow("Import payload must be a valid version 1 backup with well-formed profiles, presets, settings, and history.");
  });

  it("rejects imported presets when field-type metadata is structurally inconsistent", async () => {
    await expect(
      importAppData({
        version: 1,
        profiles: [],
        presets: [
          {
            id: "preset-1",
            name: "Broken Metadata Preset",
            formKey: "form-1",
            formTitle: "Broken Metadata",
            fields: [
              {
                id: "full_name",
                label: "Full Name",
                normalizedLabel: "full name",
                type: "text",
                required: true,
                gridMode: "radio",
              },
            ],
            values: {},
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        settings: {
          defaultProfileId: null,
          autoLoadMatchingProfile: true,
          confirmBeforeFill: true,
          showBackupSection: false,
        },
      }),
    ).rejects.toThrow("Import payload must be a valid version 1 backup with well-formed profiles, presets, settings, and history.");

    await expect(
      importAppData({
        version: 1,
        profiles: [],
        presets: [
          {
            id: "preset-2",
            name: "Grid Without Mode",
            formKey: "form-2",
            formTitle: "Grid Without Mode",
            fields: [
              {
                id: "availability",
                label: "Availability",
                normalizedLabel: "availability",
                type: "grid",
                required: false,
                gridRows: ["Morning", "Evening"],
              },
            ],
            values: {},
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        settings: {
          defaultProfileId: null,
          autoLoadMatchingProfile: true,
          confirmBeforeFill: true,
          showBackupSection: false,
        },
      }),
    ).rejects.toThrow("Import payload must be a valid version 1 backup with well-formed profiles, presets, settings, and history.");
  });

  it("filters malformed stored records on read", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.profiles = [
      {
        id: "profile-1",
        name: "Valid",
        values: { fullName: "Toufiq Hasan" },
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "broken-profile",
        name: "Broken",
        values: { fullName: { nested: true } },
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "broken-profile-2",
        name: "Broken 2",
        values: { fullName: "NaN Timestamp" },
        createdAt: Number.NaN,
        updatedAt: 1,
      },
      {
        id: "broken-profile-3",
        name: "Broken 3",
        values: { score: Number.POSITIVE_INFINITY },
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    chromeWithState.state.presets = [
      {
        id: "preset-1",
        name: "Valid Preset",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [],
        values: {},
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "preset-2",
        name: "Broken Preset",
        formKey: "form-2",
        fields: [{ id: "field", label: "Field", normalizedLabel: "field", type: "grid", required: false, gridMode: "broken" }],
        values: {},
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "preset-3",
        name: "Broken Preset 2",
        formKey: "form-3",
        formTitle: "Form 3",
        fields: [{ id: "field", label: "Field", normalizedLabel: "field", type: "text", required: false, gridMode: "radio" }],
        values: {},
        createdAt: 2,
        updatedAt: 2,
      },
      {
        id: "preset-5",
        name: "Broken Preset 4",
        formKey: "form-5",
        formTitle: "Form 5",
        fields: [],
        values: {},
        createdAt: 3,
        updatedAt: Number.POSITIVE_INFINITY,
      },
      {
        id: "preset-6",
        name: "Broken Preset 5",
        formKey: "form-6",
        formTitle: "Form 6",
        fields: [],
        values: {
          score: Number.NaN,
        },
        createdAt: 4,
        updatedAt: 4,
      },
      {
        id: "preset-4",
        name: "Broken Preset 3",
        formKey: "form-4",
        formTitle: "Form 4",
        fields: [
          {
            id: "department",
            label: "Department",
            normalizedLabel: "department",
            type: "radio",
            required: false,
            options: ["CSE", "Other"],
            otherOption: "Other",
          },
        ],
        values: {
          department: {
            kind: "choice_with_other",
            selected: "Other",
          },
        },
        createdAt: 3,
        updatedAt: 3,
      },
    ];
    chromeWithState.state.history = [
      {
        id: "history-1",
        formKey: "form-1",
        formTitle: "Form 1",
        lastUsedProfileId: null,
        lastFilledAt: 10,
        filledFieldCount: 1,
        skippedFieldCount: 0,
      },
      {
        id: "history-2",
        formKey: "form-2",
        formTitle: "Form 2",
        lastUsedProfileId: { broken: true },
        lastFilledAt: 11,
        filledFieldCount: 1,
        skippedFieldCount: 0,
      },
      {
        id: "history-3",
        formKey: "form-3",
        formTitle: "Form 3",
        lastUsedProfileId: null,
        lastFilledAt: Number.NaN,
        filledFieldCount: 1,
        skippedFieldCount: 0,
      },
    ];
    chromeWithState.state.settings = {
      defaultProfileId: ["broken"],
      autoLoadMatchingProfile: true,
      confirmBeforeFill: true,
      showBackupSection: false,
    };

    expect(await getProfiles()).toEqual([
      {
        id: "profile-1",
        name: "Valid",
        values: { fullName: "Toufiq Hasan" },
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    expect(await getPresetByFormKey("form-1")).toEqual({
      id: "preset-1",
      name: "Valid Preset",
      formKey: "form-1",
      formTitle: "Form 1",
      fields: [],
      values: {},
      createdAt: 1,
      updatedAt: 1,
    });
    expect(await getPresetByFormKey("form-2")).toBeNull();
    expect(await getPresetByFormKey("form-3")).toBeNull();
    expect(await getPresetByFormKey("form-4")).toBeNull();
    expect(await getPresetByFormKey("form-5")).toBeNull();
    expect(await getPresetByFormKey("form-6")).toBeNull();
    expect(await getSettings()).toEqual({
      defaultProfileId: null,
      autoLoadMatchingProfile: true,
      confirmBeforeFill: true,
      showBackupSection: false,
    });

    const exported = await exportAppData();
    expect(exported.profiles).toHaveLength(1);
    expect(exported.presets).toHaveLength(1);
    expect(exported.history).toEqual([
      {
        id: "history-1",
        formKey: "form-1",
        formTitle: "Form 1",
        lastUsedProfileId: null,
        lastUsedProfileName: null,
        lastFilledAt: 10,
        filledFieldCount: 1,
        skippedFieldCount: 0,
      },
    ]);
  });

  it("deduplicates stored presets by form key and keeps the newest one", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.presets = [
      {
        id: "preset-old",
        name: "Old Preset",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [],
        values: { fullName: "Old" },
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "preset-new",
        name: "New Preset",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [],
        values: { fullName: "New" },
        createdAt: 2,
        updatedAt: 2,
      },
    ];

    expect(await getPresetByFormKey("form-1")).toEqual({
      id: "preset-new",
      name: "New Preset",
      formKey: "form-1",
      formTitle: "Form 1",
      fields: [],
      values: { fullName: "New" },
      createdAt: 2,
      updatedAt: 2,
    });

    const exported = await exportAppData();
    expect(exported.presets).toEqual([
      {
        id: "preset-new",
        name: "New Preset",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [],
        values: { fullName: "New" },
        createdAt: 2,
        updatedAt: 2,
      },
    ]);
  });

  it("deduplicates stored presets by id and keeps the newest one", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.presets = [
      {
        id: "preset-1",
        name: "Old Preset",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [],
        values: { fullName: "Old" },
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "preset-1",
        name: "New Preset",
        formKey: "form-2",
        formTitle: "Form 2",
        fields: [],
        values: { fullName: "New" },
        createdAt: 2,
        updatedAt: 2,
      },
    ];

    expect(await getPresetByFormKey("form-1")).toBeNull();
    expect(await getPresetByFormKey("form-2")).toEqual({
      id: "preset-1",
      name: "New Preset",
      formKey: "form-2",
      formTitle: "Form 2",
      fields: [],
      values: { fullName: "New" },
      createdAt: 2,
      updatedAt: 2,
    });

    const exported = await exportAppData();
    expect(exported.presets).toEqual([
      {
        id: "preset-1",
        name: "New Preset",
        formKey: "form-2",
        formTitle: "Form 2",
        fields: [],
        values: { fullName: "New" },
        createdAt: 2,
        updatedAt: 2,
      },
    ]);
  });

  it("clears a stale default profile id when the profile no longer exists", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.profiles = [
      {
        id: "profile-1",
        name: "Valid",
        values: { fullName: "Toufiq Hasan" },
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    chromeWithState.state.settings = {
      defaultProfileId: "missing-profile",
      autoLoadMatchingProfile: true,
      confirmBeforeFill: true,
      showBackupSection: false,
    };

    expect(await getSettings()).toEqual({
      defaultProfileId: null,
      autoLoadMatchingProfile: true,
      confirmBeforeFill: true,
      showBackupSection: false,
    });

    const exported = await exportAppData();
    expect(exported.settings).toEqual({
      defaultProfileId: null,
      autoLoadMatchingProfile: true,
      confirmBeforeFill: true,
      showBackupSection: false,
    });
  });

  it("clears deleted profile references from saved form history", async () => {
    await saveProfile({
      id: "profile-1",
      name: "Alpha",
      values: { fullName: "Toufiq Hasan" },
      createdAt: 1,
      updatedAt: 1,
    });

    await importAppData({
      version: 1,
      profiles: [
        {
          id: "profile-1",
          name: "Alpha",
          values: { fullName: "Toufiq Hasan" },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      history: [
        {
          id: "history-1",
          formKey: "form-1",
          formTitle: "Form 1",
          lastUsedProfileId: "profile-1",
          lastUsedProfileName: "Alpha",
          lastFilledAt: 10,
          filledFieldCount: 2,
          skippedFieldCount: 0,
        },
      ],
      settings: {
        defaultProfileId: "profile-1",
        autoLoadMatchingProfile: true,
        confirmBeforeFill: true,
        showBackupSection: false,
      },
    });

    await deleteProfile("profile-1");

    expect(await getFormHistory()).toEqual([
      {
        id: "history-1",
        formKey: "form-1",
        formTitle: "Form 1",
        lastUsedProfileId: null,
        lastUsedProfileName: null,
        lastFilledAt: 10,
        filledFieldCount: 2,
        skippedFieldCount: 0,
      },
    ]);

    const exported = await exportAppData();
    expect(exported.settings).toEqual({
      defaultProfileId: null,
      autoLoadMatchingProfile: true,
      confirmBeforeFill: true,
      showBackupSection: false,
    });
    expect(exported.history).toEqual([
      {
        id: "history-1",
        formKey: "form-1",
        formTitle: "Form 1",
        lastUsedProfileId: null,
        lastUsedProfileName: null,
        lastFilledAt: 10,
        filledFieldCount: 2,
        skippedFieldCount: 0,
      },
    ]);
  });

  it("drops stale profile references when saving a new history entry", async () => {
    await saveHistoryEntry({
      id: "history-1",
      formKey: "form-1",
      formTitle: "Form 1",
      lastUsedProfileId: "missing-profile",
      lastUsedProfileName: "Ghost",
      lastFilledAt: 10,
      filledFieldCount: 2,
      skippedFieldCount: 0,
    });

    expect(await getFormHistory()).toEqual([
      {
        id: "history-1",
        formKey: "form-1",
        formTitle: "Form 1",
        lastUsedProfileId: null,
        lastUsedProfileName: null,
        lastFilledAt: 10,
        filledFieldCount: 2,
        skippedFieldCount: 0,
      },
    ]);
  });

  it("normalizes stored history names against the current profile list", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.profiles = [
      {
        id: "profile-1",
        name: "Alpha Current",
        values: { fullName: "Alice" },
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    chromeWithState.state.history = [
      {
        id: "history-1",
        formKey: "form-1",
        formTitle: "Form 1",
        lastUsedProfileId: "profile-1",
        lastUsedProfileName: "Old Alpha",
        lastFilledAt: 2,
        filledFieldCount: 1,
        skippedFieldCount: 0,
      },
      {
        id: "history-2",
        formKey: "form-2",
        formTitle: "Form 2",
        lastUsedProfileId: null,
        lastUsedProfileName: "Ghost",
        lastFilledAt: 1,
        filledFieldCount: 1,
        skippedFieldCount: 0,
      },
    ];

    expect(await getFormHistory()).toEqual([
      {
        id: "history-1",
        formKey: "form-1",
        formTitle: "Form 1",
        lastUsedProfileId: "profile-1",
        lastUsedProfileName: "Alpha Current",
        lastFilledAt: 2,
        filledFieldCount: 1,
        skippedFieldCount: 0,
      },
      {
        id: "history-2",
        formKey: "form-2",
        formTitle: "Form 2",
        lastUsedProfileId: null,
        lastUsedProfileName: null,
        lastFilledAt: 1,
        filledFieldCount: 1,
        skippedFieldCount: 0,
      },
    ]);

    const exported = await exportAppData();
    expect(exported.history).toEqual([
      {
        id: "history-1",
        formKey: "form-1",
        formTitle: "Form 1",
        lastUsedProfileId: "profile-1",
        lastUsedProfileName: "Alpha Current",
        lastFilledAt: 2,
        filledFieldCount: 1,
        skippedFieldCount: 0,
      },
      {
        id: "history-2",
        formKey: "form-2",
        formTitle: "Form 2",
        lastUsedProfileId: null,
        lastUsedProfileName: null,
        lastFilledAt: 1,
        filledFieldCount: 1,
        skippedFieldCount: 0,
      },
    ]);
  });

  it("normalizes stale default profile ids on settings save too", async () => {
    await saveProfile({
      id: "profile-1",
      name: "Valid",
      values: { fullName: "Toufiq Hasan" },
      createdAt: 1,
      updatedAt: 1,
    });

    await saveSettings({
      defaultProfileId: "missing-profile",
      autoLoadMatchingProfile: true,
      confirmBeforeFill: true,
      showBackupSection: false,
    });

    expect(await getSettings()).toEqual({
      defaultProfileId: null,
      autoLoadMatchingProfile: true,
      confirmBeforeFill: true,
      showBackupSection: false,
    });

    const exported = await exportAppData();
    expect(exported.settings).toEqual({
      defaultProfileId: null,
      autoLoadMatchingProfile: true,
      confirmBeforeFill: true,
      showBackupSection: false,
    });
  });

  it("deduplicates stored profiles by id and keeps the newest one", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.profiles = [
      {
        id: "profile-1",
        name: "Old Profile",
        values: { fullName: "Old" },
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "profile-1",
        name: "New Profile",
        values: { fullName: "New" },
        createdAt: 2,
        updatedAt: 2,
      },
    ];
    chromeWithState.state.settings = {
      defaultProfileId: "profile-1",
      autoLoadMatchingProfile: true,
      confirmBeforeFill: true,
      showBackupSection: false,
    };

    expect(await getProfiles()).toEqual([
      {
        id: "profile-1",
        name: "New Profile",
        values: { fullName: "New" },
        createdAt: 2,
        updatedAt: 2,
      },
    ]);

    const exported = await exportAppData();
    expect(exported.profiles).toEqual([
      {
        id: "profile-1",
        name: "New Profile",
        values: { fullName: "New" },
        createdAt: 2,
        updatedAt: 2,
      },
    ]);
    expect(exported.settings).toEqual({
      defaultProfileId: "profile-1",
      autoLoadMatchingProfile: true,
      confirmBeforeFill: true,
      showBackupSection: false,
    });
  });

  it("normalizes stored profile aliases by trimming blanks and duplicates", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.profiles = [
      {
        id: "profile-1",
        name: "Alias Profile",
        values: { fullName: "Toufiq Hasan" },
        aliases: {
          fullName: [" Full Name ", "", "Full Name", "Legal Name", "Legal Name"],
          email: ["", "   "],
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    expect(await getProfiles()).toEqual([
      {
        id: "profile-1",
        name: "Alias Profile",
        values: { fullName: "Toufiq Hasan" },
        aliases: {
          fullName: ["Full Name", "Legal Name"],
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const exported = await exportAppData();
    expect(exported.profiles).toEqual([
      {
        id: "profile-1",
        name: "Alias Profile",
        values: { fullName: "Toufiq Hasan" },
        aliases: {
          fullName: ["Full Name", "Legal Name"],
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
  });

  it("drops alias maps that become empty after normalization", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.profiles = [
      {
        id: "profile-1",
        name: "Empty Alias Profile",
        values: { fullName: "Toufiq Hasan" },
        aliases: {
          fullName: ["", "   "],
          email: [" "],
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    expect(await getProfiles()).toEqual([
      {
        id: "profile-1",
        name: "Empty Alias Profile",
        values: { fullName: "Toufiq Hasan" },
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const exported = await exportAppData();
    expect(exported.profiles).toEqual([
      {
        id: "profile-1",
        name: "Empty Alias Profile",
        values: { fullName: "Toufiq Hasan" },
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
  });

  it("drops aliases for profile keys that no longer exist", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.profiles = [
      {
        id: "profile-1",
        name: "Alias Profile",
        values: { fullName: "Toufiq Hasan" },
        aliases: {
          fullName: ["Full Name"],
          email: ["Email Address"],
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    expect(await getProfiles()).toEqual([
      {
        id: "profile-1",
        name: "Alias Profile",
        values: { fullName: "Toufiq Hasan" },
        aliases: {
          fullName: ["Full Name"],
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const exported = await exportAppData();
    expect(exported.profiles).toEqual([
      {
        id: "profile-1",
        name: "Alias Profile",
        values: { fullName: "Toufiq Hasan" },
        aliases: {
          fullName: ["Full Name"],
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
  });

  it("deduplicates imported profiles by id before writing settings", async () => {
    await importAppData({
      version: 1,
      profiles: [
        {
          id: "profile-1",
          name: "Older Imported",
          values: { fullName: "Old" },
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "profile-1",
          name: "Newer Imported",
          values: { fullName: "New" },
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      settings: {
        defaultProfileId: "profile-1",
        autoLoadMatchingProfile: true,
        confirmBeforeFill: true,
        showBackupSection: false,
      },
    });

    expect(await getProfiles()).toEqual([
      {
        id: "profile-1",
        name: "Newer Imported",
        values: { fullName: "New" },
        createdAt: 2,
        updatedAt: 2,
      },
    ]);
    expect(await getSettings()).toEqual({
      defaultProfileId: "profile-1",
      autoLoadMatchingProfile: true,
      confirmBeforeFill: true,
      showBackupSection: false,
    });
  });

  it("deduplicates imported history by form key before export", async () => {
    await importAppData({
      version: 1,
      history: [
        {
          id: "history-old",
          formKey: "form-1",
          formTitle: "Form 1",
          lastUsedProfileId: "profile-1",
          lastFilledAt: 1,
          filledFieldCount: 1,
          skippedFieldCount: 0,
        },
        {
          id: "history-new",
          formKey: "form-1",
          formTitle: "Form 1",
          lastUsedProfileId: "profile-2",
          lastFilledAt: 5,
          filledFieldCount: 2,
          skippedFieldCount: 0,
        },
      ],
    });

    expect(await getFormHistory()).toEqual([
      {
        id: "history-new",
        formKey: "form-1",
        formTitle: "Form 1",
        lastUsedProfileId: null,
        lastUsedProfileName: null,
        lastFilledAt: 5,
        filledFieldCount: 2,
        skippedFieldCount: 0,
      },
    ]);

    const exported = await exportAppData();
    expect(exported.history).toEqual([
      {
        id: "history-new",
        formKey: "form-1",
        formTitle: "Form 1",
        lastUsedProfileId: null,
        lastUsedProfileName: null,
        lastFilledAt: 5,
        filledFieldCount: 2,
        skippedFieldCount: 0,
      },
    ]);
  });

  it("drops stale preset metadata for fields that are no longer present", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.presets = [
      {
        id: "preset-1",
        name: "Registration",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [{ id: "full_name", label: "Full Name", normalizedLabel: "full name", type: "text", required: true }],
        values: { full_name: "Toufiq", old_field: "stale@example.com" },
        mappings: { full_name: "fullName", old_field: "email" },
        unmappedFieldIds: ["old_field"],
        excludedFieldIds: ["old_field"],
        sections: [{ id: "section-1", title: "Section", fieldIds: ["full_name", "old_field"], updatedAt: 1 }],
        mappingSchemaVersion: 2,
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    expect(await getPresetByFormKey("form-1")).toEqual({
      id: "preset-1",
      name: "Registration",
      formKey: "form-1",
      formTitle: "Form 1",
      fields: [{ id: "full_name", label: "Full Name", normalizedLabel: "full name", type: "text", required: true }],
      values: { full_name: "Toufiq" },
      mappings: { full_name: "fullName" },
      sections: [{ id: "section-1", title: "Section", fieldIds: ["full_name"], updatedAt: 1 }],
      mappingSchemaVersion: 2,
      createdAt: 1,
      updatedAt: 1,
    });

    const exported = await exportAppData();
    expect(exported.presets).toEqual([
      {
        id: "preset-1",
        name: "Registration",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [{ id: "full_name", label: "Full Name", normalizedLabel: "full name", type: "text", required: true }],
        values: { full_name: "Toufiq" },
        mappings: { full_name: "fullName" },
        sections: [{ id: "section-1", title: "Section", fieldIds: ["full_name"], updatedAt: 1 }],
        mappingSchemaVersion: 2,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
  });

  it("deduplicates preset sections by section id and keeps the newest snapshot", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.presets = [
      {
        id: "preset-1",
        name: "Registration",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [{ id: "full_name", label: "Full Name", normalizedLabel: "full name", type: "text", required: true }],
        values: { full_name: "Toufiq" },
        sections: [
          { id: "section-1", title: "Old Title", fieldIds: ["full_name"], updatedAt: 1 },
          { id: "section-1", title: "New Title", fieldIds: ["full_name", "full_name"], updatedAt: 2 },
        ],
        mappingSchemaVersion: 2,
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    expect(await getPresetByFormKey("form-1")).toEqual({
      id: "preset-1",
      name: "Registration",
      formKey: "form-1",
      formTitle: "Form 1",
      fields: [{ id: "full_name", label: "Full Name", normalizedLabel: "full name", type: "text", required: true }],
      values: { full_name: "Toufiq" },
      sections: [{ id: "section-1", title: "New Title", fieldIds: ["full_name"], updatedAt: 2 }],
      mappingSchemaVersion: 2,
      createdAt: 1,
      updatedAt: 1,
    });

    const exported = await exportAppData();
    expect(exported.presets).toEqual([
      {
        id: "preset-1",
        name: "Registration",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [{ id: "full_name", label: "Full Name", normalizedLabel: "full name", type: "text", required: true }],
        values: { full_name: "Toufiq" },
        sections: [{ id: "section-1", title: "New Title", fieldIds: ["full_name"], updatedAt: 2 }],
        mappingSchemaVersion: 2,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
  });

  it("prefers the later section snapshot when duplicate section ids share the same updatedAt", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.presets = [
      {
        id: "preset-1",
        name: "Registration",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [{ id: "full_name", label: "Full Name", normalizedLabel: "full name", type: "text", required: true }],
        values: { full_name: "Toufiq" },
        sections: [
          { id: "section-1", title: "First Title", fieldIds: ["full_name"], updatedAt: 2 },
          { id: "section-1", title: "Second Title", fieldIds: ["full_name"], updatedAt: 2 },
        ],
        mappingSchemaVersion: 2,
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    expect(await getPresetByFormKey("form-1")).toEqual({
      id: "preset-1",
      name: "Registration",
      formKey: "form-1",
      formTitle: "Form 1",
      fields: [{ id: "full_name", label: "Full Name", normalizedLabel: "full name", type: "text", required: true }],
      values: { full_name: "Toufiq" },
      sections: [{ id: "section-1", title: "Second Title", fieldIds: ["full_name"], updatedAt: 2 }],
      mappingSchemaVersion: 2,
      createdAt: 1,
      updatedAt: 1,
    });
  });

  it("normalizes stored grid preset values to current row ids and valid options", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.presets = [
      {
        id: "preset-1",
        name: "Availability",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [
          {
            id: "availability",
            label: "Availability",
            normalizedLabel: "availability",
            type: "grid",
            required: false,
            options: ["Morning", "Evening"],
            gridRows: ["Monday", "Tuesday"],
            gridRowIds: ["mon", "tue"],
            gridMode: "checkbox",
          },
        ],
        values: {
          availability: {
            kind: "grid",
            rows: {
              mon: ["Morning", "Invalid"],
              Tuesday: ["Evening"],
              stale_row: ["Morning"],
            },
          },
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    expect(await getPresetByFormKey("form-1")).toEqual({
      id: "preset-1",
      name: "Availability",
      formKey: "form-1",
      formTitle: "Form 1",
      fields: [
        {
          id: "availability",
          label: "Availability",
          normalizedLabel: "availability",
          type: "grid",
          required: false,
          options: ["Morning", "Evening"],
          gridRows: ["Monday", "Tuesday"],
          gridRowIds: ["mon", "tue"],
          gridMode: "checkbox",
        },
      ],
      values: {
        availability: {
          kind: "grid",
          rows: {
            mon: ["Morning"],
            tue: ["Evening"],
          },
        },
      },
      createdAt: 1,
      updatedAt: 1,
    });

    const exported = await exportAppData();
    expect(exported.presets).toEqual([
      {
        id: "preset-1",
        name: "Availability",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [
          {
            id: "availability",
            label: "Availability",
            normalizedLabel: "availability",
            type: "grid",
            required: false,
            options: ["Morning", "Evening"],
            gridRows: ["Monday", "Tuesday"],
            gridRowIds: ["mon", "tue"],
            gridMode: "checkbox",
          },
        ],
        values: {
          availability: {
            kind: "grid",
            rows: {
              mon: ["Morning"],
              tue: ["Evening"],
            },
          },
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
  });

  it("normalizes stored choice-with-other preset values to current options", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.presets = [
      {
        id: "preset-1",
        name: "Choices",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [
          {
            id: "department",
            label: "Department",
            normalizedLabel: "department",
            type: "radio",
            required: false,
            options: ["CSE", "Other"],
            otherOption: "Other",
          },
          {
            id: "topics",
            label: "Topics",
            normalizedLabel: "topics",
            type: "checkbox",
            required: false,
            options: ["Math", "Other", "Physics"],
            otherOption: "Other",
          },
        ],
        values: {
          department: {
            kind: "choice_with_other",
            selected: "Other",
            otherText: "  AI  ",
          },
          topics: {
            kind: "choice_with_other",
            selected: ["Math", "Other", "Invalid"],
            otherText: "   ",
          },
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    expect(await getPresetByFormKey("form-1")).toEqual({
      id: "preset-1",
      name: "Choices",
      formKey: "form-1",
      formTitle: "Form 1",
      fields: [
        {
          id: "department",
          label: "Department",
          normalizedLabel: "department",
          type: "radio",
          required: false,
          options: ["CSE", "Other"],
          otherOption: "Other",
        },
        {
          id: "topics",
          label: "Topics",
          normalizedLabel: "topics",
          type: "checkbox",
          required: false,
          options: ["Math", "Other", "Physics"],
          otherOption: "Other",
        },
      ],
      values: {
        department: {
          kind: "choice_with_other",
          selected: "Other",
          otherText: "AI",
        },
        topics: {
          kind: "choice_with_other",
          selected: ["Math", "Other"],
          otherText: "Invalid",
        },
      },
      createdAt: 1,
      updatedAt: 1,
    });

    const exported = await exportAppData();
    expect(exported.presets).toEqual([
      {
        id: "preset-1",
        name: "Choices",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [
          {
            id: "department",
            label: "Department",
            normalizedLabel: "department",
            type: "radio",
            required: false,
            options: ["CSE", "Other"],
            otherOption: "Other",
          },
          {
            id: "topics",
            label: "Topics",
            normalizedLabel: "topics",
            type: "checkbox",
            required: false,
            options: ["Math", "Other", "Physics"],
            otherOption: "Other",
          },
        ],
        values: {
          department: {
            kind: "choice_with_other",
            selected: "Other",
            otherText: "AI",
          },
          topics: {
            kind: "choice_with_other",
            selected: ["Math", "Other"],
            otherText: "Invalid",
          },
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
  });

  it("normalizes stored plain checkbox preset values to current options", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.presets = [
      {
        id: "preset-1",
        name: "Topics",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [
          {
            id: "topics",
            label: "Topics",
            normalizedLabel: "topics",
            type: "checkbox",
            required: false,
            options: ["Math", "Other", "Physics"],
            otherOption: "Other",
          },
        ],
        values: {
          topics: [" Math ", "Invalid", "Other"],
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    expect(await getPresetByFormKey("form-1")).toEqual({
      id: "preset-1",
      name: "Topics",
      formKey: "form-1",
      formTitle: "Form 1",
      fields: [
        {
          id: "topics",
          label: "Topics",
          normalizedLabel: "topics",
          type: "checkbox",
          required: false,
          options: ["Math", "Other", "Physics"],
          otherOption: "Other",
        },
      ],
      values: {
        topics: {
          kind: "choice_with_other",
          selected: ["Math", "Other"],
          otherText: "Invalid",
        },
      },
      createdAt: 1,
      updatedAt: 1,
    });

    const exported = await exportAppData();
    expect(exported.presets).toEqual([
      {
        id: "preset-1",
        name: "Topics",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [
          {
            id: "topics",
            label: "Topics",
            normalizedLabel: "topics",
            type: "checkbox",
            required: false,
            options: ["Math", "Other", "Physics"],
            otherOption: "Other",
          },
        ],
        values: {
          topics: {
            kind: "choice_with_other",
            selected: ["Math", "Other"],
            otherText: "Invalid",
          },
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
  });

  it("normalizes stored plain option preset values to current options", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.presets = [
      {
        id: "preset-1",
        name: "Options",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [
          {
            id: "department",
            label: "Department",
            normalizedLabel: "department",
            type: "radio",
            required: false,
            options: ["CSE", "EEE"],
          },
          {
            id: "batch",
            label: "Batch",
            normalizedLabel: "batch",
            type: "dropdown",
            required: false,
            options: ["47", "48"],
          },
          {
            id: "rating",
            label: "Rating",
            normalizedLabel: "rating",
            type: "scale",
            required: false,
            options: ["1", "2", "3"],
          },
        ],
        values: {
          department: "Invalid",
          batch: "48",
          rating: "9",
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    expect(await getPresetByFormKey("form-1")).toEqual({
      id: "preset-1",
      name: "Options",
      formKey: "form-1",
      formTitle: "Form 1",
      fields: [
        {
          id: "department",
          label: "Department",
          normalizedLabel: "department",
          type: "radio",
          required: false,
          options: ["CSE", "EEE"],
        },
        {
          id: "batch",
          label: "Batch",
          normalizedLabel: "batch",
          type: "dropdown",
          required: false,
          options: ["47", "48"],
        },
        {
          id: "rating",
          label: "Rating",
          normalizedLabel: "rating",
          type: "scale",
          required: false,
          options: ["1", "2", "3"],
        },
      ],
      values: {
        batch: "48",
      },
      createdAt: 1,
      updatedAt: 1,
    });

    const exported = await exportAppData();
    expect(exported.presets).toEqual([
      {
        id: "preset-1",
        name: "Options",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [
          {
            id: "department",
            label: "Department",
            normalizedLabel: "department",
            type: "radio",
            required: false,
            options: ["CSE", "EEE"],
          },
          {
            id: "batch",
            label: "Batch",
            normalizedLabel: "batch",
            type: "dropdown",
            required: false,
            options: ["47", "48"],
          },
          {
            id: "rating",
            label: "Rating",
            normalizedLabel: "rating",
            type: "scale",
            required: false,
            options: ["1", "2", "3"],
          },
        ],
        values: {
          batch: "48",
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
  });

  it("drops placeholder dropdown fallback values when no real options are available", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.presets = [
      {
        id: "preset-1",
        name: "Dropdowns",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [
          {
            id: "department",
            label: "Department",
            normalizedLabel: "department",
            type: "dropdown",
            required: false,
            options: [],
          },
          {
            id: "batch",
            label: "Batch",
            normalizedLabel: "batch",
            type: "dropdown",
            required: false,
            options: [],
          },
        ],
        values: {
          department: "Select an option",
          batch: "48th",
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    expect(await getPresetByFormKey("form-1")).toEqual({
      id: "preset-1",
      name: "Dropdowns",
      formKey: "form-1",
      formTitle: "Form 1",
      fields: [
        {
          id: "department",
          label: "Department",
          normalizedLabel: "department",
          type: "dropdown",
          required: false,
          options: [],
        },
        {
          id: "batch",
          label: "Batch",
          normalizedLabel: "batch",
          type: "dropdown",
          required: false,
          options: [],
        },
      ],
      values: {
        batch: "48th",
      },
      createdAt: 1,
      updatedAt: 1,
    });

    const exported = await exportAppData();
    expect(exported.presets).toEqual([
      {
        id: "preset-1",
        name: "Dropdowns",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [
          {
            id: "department",
            label: "Department",
            normalizedLabel: "department",
            type: "dropdown",
            required: false,
            options: [],
          },
          {
            id: "batch",
            label: "Batch",
            normalizedLabel: "batch",
            type: "dropdown",
            required: false,
            options: [],
          },
        ],
        values: {
          batch: "48th",
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
  });

  it("drops invalid stored date and time preset values", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.presets = [
      {
        id: "preset-1",
        name: "Schedule",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [
          {
            id: "birthday",
            label: "Birthday",
            normalizedLabel: "birthday",
            type: "date",
            required: false,
          },
          {
            id: "meeting_time",
            label: "Meeting Time",
            normalizedLabel: "meeting time",
            type: "time",
            required: false,
          },
        ],
        values: {
          birthday: "2025-02-30",
          meeting_time: "25:61",
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    expect(await getPresetByFormKey("form-1")).toEqual({
      id: "preset-1",
      name: "Schedule",
      formKey: "form-1",
      formTitle: "Form 1",
      fields: [
        {
          id: "birthday",
          label: "Birthday",
          normalizedLabel: "birthday",
          type: "date",
          required: false,
        },
        {
          id: "meeting_time",
          label: "Meeting Time",
          normalizedLabel: "meeting time",
          type: "time",
          required: false,
        },
      ],
      values: {},
      createdAt: 1,
      updatedAt: 1,
    });

    const exported = await exportAppData();
    expect(exported.presets).toEqual([
      {
        id: "preset-1",
        name: "Schedule",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [
          {
            id: "birthday",
            label: "Birthday",
            normalizedLabel: "birthday",
            type: "date",
            required: false,
          },
          {
            id: "meeting_time",
            label: "Meeting Time",
            normalizedLabel: "meeting time",
            type: "time",
            required: false,
          },
        ],
        values: {},
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
  });

  it("drops whitespace-only stored text preset values", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.presets = [
      {
        id: "preset-1",
        name: "Text Fields",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [
          {
            id: "full_name",
            label: "Full Name",
            normalizedLabel: "full name",
            type: "text",
            required: false,
          },
          {
            id: "essay",
            label: "Essay",
            normalizedLabel: "essay",
            type: "textarea",
            required: false,
          },
        ],
        values: {
          full_name: "   ",
          essay: "Actual text",
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    expect(await getPresetByFormKey("form-1")).toEqual({
      id: "preset-1",
      name: "Text Fields",
      formKey: "form-1",
      formTitle: "Form 1",
      fields: [
        {
          id: "full_name",
          label: "Full Name",
          normalizedLabel: "full name",
          type: "text",
          required: false,
        },
        {
          id: "essay",
          label: "Essay",
          normalizedLabel: "essay",
          type: "textarea",
          required: false,
        },
      ],
      values: {
        essay: "Actual text",
      },
      createdAt: 1,
      updatedAt: 1,
    });

    const exported = await exportAppData();
    expect(exported.presets).toEqual([
      {
        id: "preset-1",
        name: "Text Fields",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [
          {
            id: "full_name",
            label: "Full Name",
            normalizedLabel: "full name",
            type: "text",
            required: false,
          },
          {
            id: "essay",
            label: "Essay",
            normalizedLabel: "essay",
            type: "textarea",
            required: false,
          },
        ],
        values: {
          essay: "Actual text",
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
  });

  it("drops non-string stored text preset values", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.presets = [
      {
        id: "preset-1",
        name: "Text Fields",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [
          {
            id: "full_name",
            label: "Full Name",
            normalizedLabel: "full name",
            type: "text",
            required: false,
          },
        ],
        values: {
          full_name: true,
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    expect(await getPresetByFormKey("form-1")).toEqual({
      id: "preset-1",
      name: "Text Fields",
      formKey: "form-1",
      formTitle: "Form 1",
      fields: [
        {
          id: "full_name",
          label: "Full Name",
          normalizedLabel: "full name",
          type: "text",
          required: false,
        },
      ],
      values: {},
      createdAt: 1,
      updatedAt: 1,
    });

    const exported = await exportAppData();
    expect(exported.presets).toEqual([
      {
        id: "preset-1",
        name: "Text Fields",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [
          {
            id: "full_name",
            label: "Full Name",
            normalizedLabel: "full name",
            type: "text",
            required: false,
          },
        ],
        values: {},
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
  });

  it("normalizes numeric stored text preset values to strings", async () => {
    const chromeWithState = chrome as typeof chrome & { state: Record<string, unknown> };
    chromeWithState.state.presets = [
      {
        id: "preset-1",
        name: "Text Fields",
        formKey: "form-1",
        formTitle: "Form 1",
        fields: [
          {
            id: "student_id",
            label: "Student ID",
            normalizedLabel: "student id",
            type: "text",
            required: false,
          },
        ],
        values: {
          student_id: 12345,
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    expect(await getPresetByFormKey("form-1")).toEqual({
      id: "preset-1",
      name: "Text Fields",
      formKey: "form-1",
      formTitle: "Form 1",
      fields: [
        {
          id: "student_id",
          label: "Student ID",
          normalizedLabel: "student id",
          type: "text",
          required: false,
        },
      ],
      values: {
        student_id: "12345",
      },
      createdAt: 1,
      updatedAt: 1,
    });
  });

  it("keeps the build manifest version in sync with package.json", async () => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as { version: string };
    const buildScript = await readFile(join(process.cwd(), "scripts", "build.ts"), "utf8");

    expect(packageJson.version).toBeTruthy();
    expect(buildScript).toContain('const manifestVersion = packageJson.version ?? "0.1.0";');
    expect(buildScript).toContain("version: manifestVersion,");
  });
});

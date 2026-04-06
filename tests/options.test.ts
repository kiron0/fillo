import type { Profile } from "../src/core/types";

const optionsHtml = `
<!doctype html>
<html>
  <body>
    <p id="status"></p>
    <select id="default-profile"></select>
    <input id="auto-load-profile" type="checkbox" />
    <input id="confirm-before-fill" type="checkbox" />
    <input id="show-backup-section" type="checkbox" />
    <button id="add-profile"></button>
    <div id="profiles"></div>
    <div id="presets"></div>
    <div id="backup-section" class="hidden"></div>
    <button id="export-data"></button>
    <button id="import-data"></button>
    <button id="clear-data"></button>
    <textarea id="backup-payload"></textarea>
  </body>
</html>
`;

function createStorageMock(initialState: Record<string, unknown>) {
  const state: Record<string, unknown> = { ...initialState };

  return {
    state,
    chrome: {
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
        lastError: undefined as chrome.runtime.LastError | undefined,
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

async function loadOptionsModule() {
  vi.resetModules();
  await import("../src/features/options/main");
  await Promise.resolve();
  await Promise.resolve();
}

describe("options", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = optionsHtml;
    vi.stubGlobal("navigator", createNavigatorLocksMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps comma-containing profile text values as strings when saved", async () => {
    const profiles: Profile[] = [
      {
        id: "profile-1",
        name: "Personal",
        values: {
          location: "Dhaka, Bangladesh",
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const mock = createStorageMock({
      profiles,
      presets: [],
      settings: {
        defaultProfileId: null,
        autoLoadMatchingProfile: true,
        confirmBeforeFill: true,
        showBackupSection: false,
      },
    });

    vi.stubGlobal("chrome", mock.chrome);

    await loadOptionsModule();

    const saveButton = document.querySelector<HTMLButtonElement>(".card-actions .button.accent")!;
    saveButton.click();
    await Promise.resolve();
    await Promise.resolve();

    expect((mock.state.profiles as Profile[])[0].values.location).toBe("Dhaka, Bangladesh");
  });

  it("lets new profile rows be saved as list values for checkbox mappings", async () => {
    const profiles: Profile[] = [
      {
        id: "profile-1",
        name: "Personal",
        values: {
          fullName: "Toufiq Hasan",
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const mock = createStorageMock({
      profiles,
      presets: [],
      settings: {
        defaultProfileId: null,
        autoLoadMatchingProfile: true,
        confirmBeforeFill: true,
        showBackupSection: false,
      },
    });

    vi.stubGlobal("chrome", mock.chrome);

    await loadOptionsModule();

    const addFieldButton = document.querySelector<HTMLButtonElement>(".card-actions button")!;
    addFieldButton.click();

    const rows = Array.from(document.querySelectorAll<HTMLElement>(".value-row"));
    const newRow = rows[rows.length - 1]!;
    const keyInput = newRow.querySelector<HTMLInputElement>("input")!;
    const typeSelect = newRow.querySelector<HTMLSelectElement>("select")!;
    const valueInput = newRow.querySelectorAll<HTMLInputElement>("input")[1]!;

    keyInput.value = "topics";
    keyInput.dispatchEvent(new Event("input", { bubbles: true }));
    typeSelect.value = "array";
    typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    valueInput.value = "Math, Physics";
    valueInput.dispatchEvent(new Event("input", { bubbles: true }));

    const saveButton = document.querySelector<HTMLButtonElement>(".card-actions .button.accent")!;
    saveButton.click();
    await vi.waitFor(() => {
      expect((mock.state.profiles as Profile[])[0].values.topics).toEqual(["Math", "Physics"]);
    });
  });

  it("preserves unsaved edits on other profile cards when one profile is saved", async () => {
    const profiles: Profile[] = [
      {
        id: "profile-1",
        name: "Alpha",
        values: { fullName: "Alice" },
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "profile-2",
        name: "Beta",
        values: { fullName: "Bob" },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const mock = createStorageMock({
      profiles,
      presets: [],
      settings: {
        defaultProfileId: null,
        autoLoadMatchingProfile: true,
        confirmBeforeFill: true,
        showBackupSection: false,
      },
    });

    vi.stubGlobal("chrome", mock.chrome);

    await loadOptionsModule();

    const cards = Array.from(document.querySelectorAll<HTMLElement>(".card"));
    const secondCardNameInput = cards[1]!.querySelector<HTMLInputElement>('[data-role="profile-name"]')!;
    secondCardNameInput.value = "Beta Draft";

    const firstCardSaveButton = cards[0]!.querySelector<HTMLButtonElement>(".button.accent")!;
    firstCardSaveButton.click();

    await vi.waitFor(() => {
      expect(secondCardNameInput.value).toBe("Beta Draft");
    });
  });

  it("preserves profile drafts when settings save and add profile run", async () => {
    const profiles: Profile[] = [
      {
        id: "profile-1",
        name: "Alpha",
        values: { fullName: "Alice" },
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "profile-2",
        name: "Beta",
        values: { fullName: "Bob" },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const mock = createStorageMock({
      profiles,
      presets: [],
      settings: {
        defaultProfileId: null,
        autoLoadMatchingProfile: true,
        confirmBeforeFill: true,
        showBackupSection: false,
      },
    });

    vi.stubGlobal("chrome", mock.chrome);

    await loadOptionsModule();

    const cards = Array.from(document.querySelectorAll<HTMLElement>(".card"));
    const draftInput = cards[1]!.querySelector<HTMLInputElement>('[data-role="profile-name"]')!;
    draftInput.value = "Beta Draft";

    const autoLoadCheckbox = document.querySelector<HTMLInputElement>("#auto-load-profile")!;
    autoLoadCheckbox.checked = false;
    autoLoadCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    document.querySelector<HTMLButtonElement>("#add-profile")!.click();
    await vi.waitFor(() => {
      expect(draftInput.value).toBe("Beta Draft");
      expect((mock.state.profiles as Profile[])).toHaveLength(3);
    });
    expect(document.querySelector(".card .profile-meta")?.textContent).toContain("saved value");
  });

  it("restores normalized settings after saving a stale default profile selection", async () => {
    const mock = createStorageMock({
      profiles: [],
      presets: [],
      settings: {
        defaultProfileId: null,
        autoLoadMatchingProfile: true,
        confirmBeforeFill: true,
        showBackupSection: false,
      },
    });

    vi.stubGlobal("chrome", mock.chrome);

    await loadOptionsModule();

    const defaultProfileSelect = document.querySelector<HTMLSelectElement>("#default-profile")!;
    const staleOption = document.createElement("option");
    staleOption.value = "missing-profile";
    staleOption.textContent = "Missing Profile";
    defaultProfileSelect.append(staleOption);
    defaultProfileSelect.value = "missing-profile";
    defaultProfileSelect.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => {
      expect((mock.state.settings as Record<string, unknown>).defaultProfileId).toBeNull();
      expect(defaultProfileSelect.value).toBe("");
    });
  });

  it("keeps the first existing profile meta after adding another profile", async () => {
    const profiles: Profile[] = [
      {
        id: "profile-1",
        name: "Alpha",
        values: { fullName: "Alice", email: "alice@example.com" },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const mock = createStorageMock({
      profiles,
      presets: [],
      settings: {
        defaultProfileId: null,
        autoLoadMatchingProfile: true,
        confirmBeforeFill: true,
        showBackupSection: false,
      },
    });

    vi.stubGlobal("chrome", mock.chrome);

    await loadOptionsModule();

    const firstMeta = document.querySelector<HTMLElement>('[data-profile-id="profile-1"] .profile-meta')!;
    expect(firstMeta.textContent).toContain("2 saved values");

    document.querySelector<HTMLButtonElement>("#add-profile")!.click();
    await vi.waitFor(() => {
      expect(document.querySelectorAll<HTMLElement>(".card[data-profile-id]")).toHaveLength(2);
    });

    expect(document.querySelector<HTMLElement>('[data-profile-id="profile-1"] .profile-meta')?.textContent).toContain("2 saved values");
  });

  it("preserves profile drafts when presets change and other profiles are deleted", async () => {
    const profiles: Profile[] = [
      {
        id: "profile-1",
        name: "Alpha",
        values: { fullName: "Alice" },
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "profile-2",
        name: "Beta",
        values: { fullName: "Bob" },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const mock = createStorageMock({
      profiles,
      presets: [
        {
          id: "preset-1",
          name: "Registration",
          formKey: "form-1",
          formTitle: "Registration",
          fields: [],
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
    });

    vi.stubGlobal("chrome", mock.chrome);

    await loadOptionsModule();

    const cards = Array.from(document.querySelectorAll<HTMLElement>(".card"));
    const draftInput = cards[1]!.querySelector<HTMLInputElement>('[data-role="profile-name"]')!;
    draftInput.value = "Beta Draft";

    const presetTitleInput = document.querySelectorAll<HTMLInputElement>(".card input")[2]!;
    presetTitleInput.value = "Renamed preset";
    document.querySelectorAll<HTMLButtonElement>(".button.accent")[1]!.click();
    await Promise.resolve();
    await Promise.resolve();

    document.querySelector<HTMLButtonElement>(".card button:last-child")!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(draftInput.value).toBe("Beta Draft");
  });

  it("shows an error message when adding a profile fails", async () => {
    const mock = createStorageMock({
      profiles: [],
      presets: [],
      settings: {
        defaultProfileId: null,
        autoLoadMatchingProfile: true,
        confirmBeforeFill: true,
        showBackupSection: false,
      },
    });

    const runtimeWithLastError = mock.chrome.runtime as { lastError?: chrome.runtime.LastError };
    mock.chrome.storage.local.set = (_value: Record<string, unknown>, callback: () => void) => {
      runtimeWithLastError.lastError = { message: "Disk full" } as chrome.runtime.LastError;
      callback();
      delete runtimeWithLastError.lastError;
    };

    vi.stubGlobal("chrome", mock.chrome);

    await loadOptionsModule();

    document.querySelector<HTMLButtonElement>("#add-profile")!.click();
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLParagraphElement>("#status")!.textContent).toBe("Disk full");
    });
  });

  it("refreshes a saved profile card from normalized storage state", async () => {
    const profiles: Profile[] = [
      {
        id: "profile-1",
        name: "Personal",
        values: { fullName: "Toufiq Hasan" },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const mock = createStorageMock({
      profiles,
      presets: [],
      settings: {
        defaultProfileId: null,
        autoLoadMatchingProfile: true,
        confirmBeforeFill: true,
        showBackupSection: false,
      },
    });

    vi.stubGlobal("chrome", mock.chrome);

    await loadOptionsModule();

    const card = document.querySelector<HTMLElement>('[data-profile-id="profile-1"]')!;
    const aliasInput = card.querySelector<HTMLInputElement>('input[placeholder="Aliases"]')!;
    aliasInput.value = " Full Name , , Full Name , Old Email ";
    aliasInput.dispatchEvent(new Event("input", { bubbles: true }));

    const addFieldButton = card.querySelector<HTMLButtonElement>(".card-actions button")!;
    addFieldButton.click();

    const rows = Array.from(card.querySelectorAll<HTMLElement>(".value-row"));
    const newRow = rows[rows.length - 1]!;
    const newKeyInput = newRow.querySelector<HTMLInputElement>("input")!;
    const newAliasInput = newRow.querySelector<HTMLInputElement>('input[placeholder="Aliases"]')!;
    newKeyInput.value = "email";
    newKeyInput.dispatchEvent(new Event("input", { bubbles: true }));
    newAliasInput.value = " Email Address ";
    newAliasInput.dispatchEvent(new Event("input", { bubbles: true }));
    newRow.remove();

    const saveButton = card.querySelector<HTMLButtonElement>(".button.accent")!;
    saveButton.click();

    await vi.waitFor(() => {
      expect((mock.state.profiles as Profile[])[0]).toEqual({
        id: "profile-1",
        name: "Personal",
        values: { fullName: "Toufiq Hasan" },
        aliases: {
          fullName: ["Full Name", "Old Email"],
        },
        createdAt: 1,
        updatedAt: expect.any(Number),
      });
    });

    const refreshedCard = document.querySelector<HTMLElement>('[data-profile-id="profile-1"]')!;
    const refreshedAliasInput = refreshedCard.querySelector<HTMLInputElement>('input[placeholder="Aliases"]')!;
    expect(refreshedAliasInput.value).toBe("Full Name, Old Email");
  });

  it("rejects backup payloads without version 1", async () => {
    const mock = createStorageMock({
      profiles: [],
      presets: [],
      settings: {
        defaultProfileId: null,
        autoLoadMatchingProfile: true,
        confirmBeforeFill: true,
        showBackupSection: false,
      },
    });

    vi.stubGlobal("chrome", mock.chrome);

    await loadOptionsModule();

    const backupPayload = document.querySelector<HTMLTextAreaElement>("#backup-payload")!;
    backupPayload.value = JSON.stringify({
      profiles: [],
      presets: [],
      settings: {
        defaultProfileId: null,
        autoLoadMatchingProfile: true,
        confirmBeforeFill: true,
        showBackupSection: false,
      },
    });

    document.querySelector<HTMLButtonElement>("#import-data")!.click();
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLParagraphElement>("#status")!.textContent).toBe(
        "Import payload must be a valid version 1 backup with well-formed profiles, presets, settings, and history.",
      );
    });
  });

  it("rejects structurally invalid presets during backup import", async () => {
    const mock = createStorageMock({
      profiles: [],
      presets: [],
      settings: {
        defaultProfileId: null,
        autoLoadMatchingProfile: true,
        confirmBeforeFill: true,
        showBackupSection: false,
      },
    });

    vi.stubGlobal("chrome", mock.chrome);

    await loadOptionsModule();

    const backupPayload = document.querySelector<HTMLTextAreaElement>("#backup-payload")!;
    backupPayload.value = JSON.stringify({
      version: 1,
      profiles: [],
      presets: [{}],
      settings: {
        defaultProfileId: null,
        autoLoadMatchingProfile: true,
        confirmBeforeFill: true,
        showBackupSection: false,
      },
    });

    document.querySelector<HTMLButtonElement>("#import-data")!.click();
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLParagraphElement>("#status")!.textContent).toBe(
        "Import payload must be a valid version 1 backup with well-formed profiles, presets, settings, and history.",
      );
    });
  });
});

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
      runtime: {},
    },
  };
}

async function loadOptionsModule() {
  vi.resetModules();
  await import("../src/features/options/main.ts");
  await Promise.resolve();
  await Promise.resolve();
}

describe("options", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = optionsHtml;
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
});

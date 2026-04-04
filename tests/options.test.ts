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
});

import type { ActiveFormContext, FormPreset, Profile } from "../src/core/types";

const popupHtml = `
<!doctype html>
<html>
  <body>
    <main class="popup-shell">
      <header class="hero">
        <h1 id="form-title"></h1>
        <p id="form-meta"></p>
      </header>
      <section id="status-card" class="status-card"></section>
      <section id="error-card" class="error-card hidden">
        <h2 id="error-title"></h2>
        <p id="error-message"></p>
      </section>
      <section id="profile-controls" class="controls hidden">
        <label>
          <select id="profile-select"></select>
        </label>
        <p id="autosave-status" class="hidden"></p>
        <div class="actions">
          <button id="reset-preset"></button>
          <button id="fill-form"></button>
          <button id="clear-values"></button>
        </div>
      </section>
      <section id="fields" class="field-list hidden"></section>
      <footer class="footer">
        <button id="open-options"></button>
      </footer>
    </main>
  </body>
</html>
`;

function createStorageMock(initialState: Record<string, unknown>) {
  const state: Record<string, unknown> = { ...initialState };
  const activeForm = initialState.__activeForm as ActiveFormContext;

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
      runtime: {
        sendMessage(message: { type: string; payload?: unknown }, callback: (response: unknown) => void) {
          if (message.type === "GET_ACTIVE_FORM_CONTEXT") {
            callback({
              ok: true,
              data: {
                status: "ready",
                context: activeForm,
              },
            });
            return;
          }

          if (message.type === "FILL_ACTIVE_FORM") {
            callback({
              ok: true,
              data: {
                filledFieldIds: [],
                skippedFieldIds: [],
              },
            });
            return;
          }

          callback({ ok: false, error: "Unknown message" });
        },
        openOptionsPage(callback: () => void) {
          callback();
        },
      },
    },
  };
}

async function loadPopupModule() {
  vi.resetModules();
  await import("../src/features/popup/main.ts");
  await Promise.resolve();
  await Promise.resolve();
}

describe("popup", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = popupHtml;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("preserves dirty values across profile switches and autosaves them", async () => {
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

    const activeForm: ActiveFormContext = {
      title: "Registration",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "popup-form",
      fields: [
        {
          id: "full_name",
          label: "Full Name",
          normalizedLabel: "full name",
          type: "text",
          required: true,
        },
      ],
    };

    const mock = createStorageMock({
      profiles,
      presets: [],
      settings: {
        defaultProfileId: "profile-1",
        autoLoadMatchingProfile: true,
        confirmBeforeFill: false,
        showBackupSection: false,
      },
      __activeForm: activeForm,
    });

    vi.stubGlobal("chrome", mock.chrome);
    vi.stubGlobal("crypto", { randomUUID: () => "preset-1" });

    await loadPopupModule();

    const input = document.querySelector<HTMLInputElement>('#fields input[type="text"]')!;
    expect(input.value).toBe("Alice");

    input.value = "Manual Name";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const autosaveNode = document.querySelector<HTMLParagraphElement>("#autosave-status")!;
    expect(autosaveNode.textContent).toBe("Saving changes...");

    const profileSelect = document.querySelector<HTMLSelectElement>("#profile-select")!;
    profileSelect.value = "profile-2";
    profileSelect.dispatchEvent(new Event("change", { bubbles: true }));

    const rerenderedInput = document.querySelector<HTMLInputElement>('#fields input[type="text"]')!;
    expect(rerenderedInput.value).toBe("Manual Name");

    await vi.advanceTimersByTimeAsync(500);
    expect(autosaveNode.textContent).toBe("All changes saved.");

    const savedPreset = (mock.state.presets as FormPreset[])[0];
    expect(savedPreset.values.full_name).toBe("Manual Name");
  });

  it("resets only the current form preset", async () => {
    const activeForm: ActiveFormContext = {
      title: "Registration",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "popup-form",
      fields: [
        {
          id: "full_name",
          label: "Full Name",
          normalizedLabel: "full name",
          type: "text",
          required: true,
        },
      ],
    };

    const preset: FormPreset = {
      id: "preset-1",
      formKey: "popup-form",
      name: "Registration",
      formTitle: "Registration",
      formUrl: activeForm.url,
      fields: activeForm.fields,
      values: { full_name: "Saved Name" },
      mappings: {},
      createdAt: 1,
      updatedAt: 1,
    };

    const mock = createStorageMock({
      profiles: [],
      presets: [preset],
      settings: {
        defaultProfileId: null,
        autoLoadMatchingProfile: false,
        confirmBeforeFill: false,
        showBackupSection: false,
      },
      __activeForm: activeForm,
    });

    vi.stubGlobal("chrome", mock.chrome);
    vi.stubGlobal("crypto", { randomUUID: () => "preset-2" });
    vi.stubGlobal("confirm", () => true);

    await loadPopupModule();

    const input = document.querySelector<HTMLInputElement>('#fields input[type="text"]')!;
    expect(input.value).toBe("Saved Name");

    const resetButton = document.querySelector<HTMLButtonElement>("#reset-preset")!;
    expect(resetButton.disabled).toBe(false);
    resetButton.click();

    await vi.waitFor(() => {
      expect((mock.state.presets as FormPreset[] | undefined) ?? []).toEqual([]);
      expect(document.querySelector<HTMLInputElement>('#fields input[type="text"]')!.value).toBe("");
      expect(document.querySelector<HTMLButtonElement>("#reset-preset")!.disabled).toBe(true);
    });
  });
});

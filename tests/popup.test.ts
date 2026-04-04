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
      <section id="status-card" class="status-card hidden"></section>
      <section id="error-card" class="error-card hidden">
        <h2 id="error-title"></h2>
        <p id="error-message"></p>
      </section>
      <section id="profile-controls" class="controls hidden">
        <label>
          <select id="profile-select"></select>
        </label>
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
        remove(keys: string[], callback: () => void) {
          for (const key of keys) {
            delete state[key];
          }
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
    vi.stubGlobal("navigator", createNavigatorLocksMock());
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

    const profileSelect = document.querySelector<HTMLSelectElement>("#profile-select")!;
    profileSelect.value = "profile-2";
    profileSelect.dispatchEvent(new Event("change", { bubbles: true }));

    const rerenderedInput = document.querySelector<HTMLInputElement>('#fields input[type="text"]')!;
    expect(rerenderedInput.value).toBe("Manual Name");

    await vi.advanceTimersByTimeAsync(500);

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

  it("keeps the status card hidden when a ready form has no message", async () => {
    const activeForm: ActiveFormContext = {
      title: "Registration",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "popup-form",
      fields: [],
    };

    const mock = createStorageMock({
      profiles: [],
      presets: [],
      settings: {
        defaultProfileId: null,
        autoLoadMatchingProfile: false,
        confirmBeforeFill: false,
        showBackupSection: false,
      },
      __activeForm: activeForm,
    });

    vi.stubGlobal("chrome", mock.chrome);
    vi.stubGlobal("crypto", { randomUUID: () => "preset-1" });

    await loadPopupModule();

    expect(document.querySelector<HTMLDivElement>("#status-card")!.classList.contains("hidden")).toBe(true);
  });

  it("removes a preset when all saved values are cleared back to blank", async () => {
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
      profiles: [],
      presets: [],
      settings: {
        defaultProfileId: null,
        autoLoadMatchingProfile: false,
        confirmBeforeFill: false,
        showBackupSection: false,
      },
      __activeForm: activeForm,
    });

    vi.stubGlobal("chrome", mock.chrome);
    vi.stubGlobal("crypto", { randomUUID: () => "preset-1" });

    await loadPopupModule();

    const input = document.querySelector<HTMLInputElement>('#fields input[type="text"]')!;
    input.value = "Manual Name";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);
    expect((mock.state.presets as FormPreset[])[0].values.full_name).toBe("Manual Name");

    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    expect((mock.state.presets as FormPreset[] | undefined) ?? []).toEqual([]);
    expect(document.querySelector<HTMLButtonElement>("#reset-preset")!.disabled).toBe(true);
  });

  it("clears the popup without deleting an existing preset", async () => {
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

    await loadPopupModule();

    document.querySelector<HTMLButtonElement>("#clear-values")!.click();
    await vi.advanceTimersByTimeAsync(500);

    expect((mock.state.presets as FormPreset[] | undefined) ?? []).toEqual([preset]);
    expect(document.querySelector<HTMLInputElement>('#fields input[type="text"]')!.value).toBe("");
    expect(document.querySelector<HTMLButtonElement>("#reset-preset")!.disabled).toBe(false);
  });

  it("does not resurrect a removed mapping when switching profiles before autosave", async () => {
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

    const preset: FormPreset = {
      id: "preset-1",
      formKey: "popup-form",
      name: "Registration",
      formTitle: "Registration",
      formUrl: activeForm.url,
      fields: activeForm.fields,
      values: { full_name: "Alice" },
      mappings: { full_name: "fullName" },
      createdAt: 1,
      updatedAt: 1,
    };

    const mock = createStorageMock({
      profiles,
      presets: [preset],
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

    const mappingSelect = document.querySelector<HTMLSelectElement>(".mapping-row select")!;
    mappingSelect.value = "";
    mappingSelect.dispatchEvent(new Event("change", { bubbles: true }));

    const profileSelect = document.querySelector<HTMLSelectElement>("#profile-select")!;
    profileSelect.value = "profile-2";
    profileSelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(document.querySelector(".mapping-row")).toBeTruthy();
    expect(document.querySelector<HTMLSelectElement>(".mapping-row select")!.value).toBe("");
    expect(document.querySelector<HTMLInputElement>('#fields input[type="text"]')!.value).toBe("Alice");
  });

  it("keeps cleared fields empty when switching profiles in the same popup session", async () => {
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

    const preset: FormPreset = {
      id: "preset-1",
      formKey: "popup-form",
      name: "Registration",
      formTitle: "Registration",
      formUrl: activeForm.url,
      fields: activeForm.fields,
      values: { full_name: "Saved Name" },
      mappings: { full_name: "fullName" },
      createdAt: 1,
      updatedAt: 1,
    };

    const mock = createStorageMock({
      profiles,
      presets: [preset],
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

    document.querySelector<HTMLButtonElement>("#clear-values")!.click();

    const profileSelect = document.querySelector<HTMLSelectElement>("#profile-select")!;
    profileSelect.value = "profile-2";
    profileSelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(document.querySelector<HTMLInputElement>('#fields input[type="text"]')!.value).toBe("");
    expect(document.querySelector<HTMLSelectElement>(".mapping-row select")!.value).toBe("");
    expect((mock.state.presets as FormPreset[] | undefined) ?? []).toEqual([preset]);
  });

  it("flushes pending autosave before filling the form", async () => {
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
      profiles: [],
      presets: [],
      settings: {
        defaultProfileId: null,
        autoLoadMatchingProfile: false,
        confirmBeforeFill: false,
        showBackupSection: false,
      },
      __activeForm: activeForm,
    });

    vi.stubGlobal("chrome", mock.chrome);
    vi.stubGlobal("crypto", { randomUUID: () => "preset-1" });

    await loadPopupModule();

    const input = document.querySelector<HTMLInputElement>('#fields input[type="text"]')!;
    input.value = "Manual Name";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    document.querySelector<HTMLButtonElement>("#fill-form")!.click();
    await vi.waitFor(() => {
      expect((mock.state.presets as FormPreset[])[0].values.full_name).toBe("Manual Name");
    });
  });

  it("flushes pending autosave when the popup page hides", async () => {
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
      profiles: [],
      presets: [],
      settings: {
        defaultProfileId: null,
        autoLoadMatchingProfile: false,
        confirmBeforeFill: false,
        showBackupSection: false,
      },
      __activeForm: activeForm,
    });

    vi.stubGlobal("chrome", mock.chrome);
    vi.stubGlobal("crypto", { randomUUID: () => "preset-1" });

    await loadPopupModule();

    const input = document.querySelector<HTMLInputElement>('#fields input[type="text"]')!;
    input.value = "Manual Name";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    window.dispatchEvent(new Event("pagehide"));
    await vi.waitFor(() => {
      expect((mock.state.presets as FormPreset[])[0].values.full_name).toBe("Manual Name");
    });
  });

  it("keeps newer checkbox selections when editing an Other value", async () => {
    const activeForm: ActiveFormContext = {
      title: "Preferences",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "checkbox-form",
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
    };

    const mock = createStorageMock({
      profiles: [],
      presets: [],
      settings: {
        defaultProfileId: null,
        autoLoadMatchingProfile: false,
        confirmBeforeFill: false,
        showBackupSection: false,
      },
      __activeForm: activeForm,
    });

    vi.stubGlobal("chrome", mock.chrome);
    vi.stubGlobal("crypto", { randomUUID: () => "preset-1" });

    await loadPopupModule();

    const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('#fields input[type="checkbox"]'));
    checkboxes[1]!.click();

    const rerenderedCheckboxes = Array.from(document.querySelectorAll<HTMLInputElement>('#fields input[type="checkbox"]'));
    rerenderedCheckboxes[0]!.click();

    const otherInput = document.querySelector<HTMLInputElement>(".other-text-input")!;
    otherInput.value = "Biology";
    otherInput.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(500);

    const savedPreset = (mock.state.presets as FormPreset[])[0]!;
    expect(savedPreset.values.topics).toEqual({
      kind: "choice_with_other",
      selected: ["Other", "Math"],
      otherText: "Biology",
    });
  });

  it("keeps an explicit No mapping choice after reopening the popup", async () => {
    const profiles: Profile[] = [
      {
        id: "profile-1",
        name: "Alpha",
        values: { fullName: "Alice" },
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

    const mappingSelect = document.querySelector<HTMLSelectElement>(".mapping-row select")!;
    mappingSelect.value = "";
    mappingSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    vi.resetModules();
    document.documentElement.innerHTML = popupHtml;
    await loadPopupModule();

    expect(document.querySelector<HTMLSelectElement>(".mapping-row select")!.value).toBe("");
  });

  it("waits for an in-flight preset save before filling the form", async () => {
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

    let releaseStorageWrite: (() => void) | null = null;
    let fillMessageSent = false;
    const state: Record<string, unknown> = {
      profiles: [],
      presets: [],
      settings: {
        defaultProfileId: null,
        autoLoadMatchingProfile: false,
        confirmBeforeFill: false,
        showBackupSection: false,
      },
      __activeForm: activeForm,
    };

    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get(keys: string[], callback: (result: Record<string, unknown>) => void) {
            callback(Object.fromEntries(keys.map((key) => [key, state[key]])));
          },
          set(value: Record<string, unknown>, callback: () => void) {
            Object.assign(state, value);
            if ("presets" in value && releaseStorageWrite === null) {
              releaseStorageWrite = callback;
              return;
            }
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
            fillMessageSent = true;
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
    });
    vi.stubGlobal("crypto", { randomUUID: () => "preset-1" });

    await loadPopupModule();

    const input = document.querySelector<HTMLInputElement>('#fields input[type="text"]')!;
    input.value = "Manual Name";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(500);
    document.querySelector<HTMLButtonElement>("#fill-form")!.click();
    await Promise.resolve();

    expect(fillMessageSent).toBe(false);
    releaseStorageWrite?.();
    await vi.waitFor(() => {
      expect(fillMessageSent).toBe(true);
    });
  });
});

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
  await import("../src/features/popup/main");
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

  it("keeps a manual override after reopening when a mapped field is edited", async () => {
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

    const input = document.querySelector<HTMLInputElement>('#fields input[type="text"]')!;
    input.value = "Manual Name";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    expect((mock.state.presets as FormPreset[])[0]).toMatchObject({
      values: { full_name: "Manual Name" },
      unmappedFieldIds: ["full_name"],
      mappingSchemaVersion: 2,
    });

    document.documentElement.innerHTML = popupHtml;
    await loadPopupModule();

    expect(document.querySelector<HTMLInputElement>('#fields input[type="text"]')!.value).toBe("Manual Name");
    expect(document.querySelector<HTMLSelectElement>(".mapping-row select")!.value).toBe("");
  });

  it("updates the mapping dropdown immediately when a mapped field is manually changed", async () => {
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

    const input = document.querySelector<HTMLInputElement>('#fields input[type="text"]')!;
    input.focus();
    input.value = "Manual Name";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(document.querySelector<HTMLSelectElement>(".mapping-row select")!.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(input.isConnected).toBe(true);
  });

  it("handles mapping updates for field ids with CSS-special characters", async () => {
    const profiles: Profile[] = [
      {
        id: "profile-1",
        name: "Alpha",
        values: { email: "alice@example.com" },
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
          id: 'entry.123["email"]',
          label: "Email",
          normalizedLabel: "email",
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
    expect(input.value).toBe("alice@example.com");

    input.value = "manual@example.com";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(document.querySelector<HTMLSelectElement>(".mapping-row select")!.value).toBe("");
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

    mock.chrome.runtime.sendMessage = (
      message: { type: string },
      callback: (response: unknown) => void,
    ) => {
      if (message.type === "GET_ACTIVE_FORM_CONTEXT") {
        callback({
          ok: true,
          data: {
            status: "unsupported_only",
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
    };

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

  it("preserves untouched saved fields after Clear when a later autosave edits only one field", async () => {
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
        {
          id: "email",
          label: "Email",
          normalizedLabel: "email",
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
      values: {
        full_name: "Saved Name",
        email: "saved@example.com",
      },
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

    mock.chrome.runtime.sendMessage = (
      message: { type: string },
      callback: (response: unknown) => void,
    ) => {
      if (message.type === "GET_ACTIVE_FORM_CONTEXT") {
        callback({
          ok: true,
          data: {
            status: "unsupported_only",
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
    };

    vi.stubGlobal("chrome", mock.chrome);
    vi.stubGlobal("crypto", { randomUUID: () => "preset-1" });

    await loadPopupModule();

    document.querySelector<HTMLButtonElement>("#clear-values")!.click();

    const inputs = document.querySelectorAll<HTMLInputElement>('#fields input[type="text"]');
    inputs[0]!.value = "New Name";
    inputs[0]!.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(500);

    expect((mock.state.presets as FormPreset[])[0]).toMatchObject({
      values: {
        full_name: "New Name",
        email: "saved@example.com",
      },
    });
  });

  it("does not preserve an old saved mapping after Clear when the user explicitly chooses No mapping", async () => {
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

    const preset: FormPreset = {
      id: "preset-1",
      formKey: "popup-form",
      name: "Registration",
      formTitle: "Registration",
      formUrl: activeForm.url,
      fields: activeForm.fields,
      values: { full_name: "Alice" },
      mappings: { full_name: "fullName" },
      mappingSchemaVersion: 2,
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

    mock.chrome.runtime.sendMessage = (
      message: { type: string },
      callback: (response: unknown) => void,
    ) => {
      if (message.type === "GET_ACTIVE_FORM_CONTEXT") {
        callback({
          ok: true,
          data: {
            status: "unsupported_only",
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
    };

    vi.stubGlobal("chrome", mock.chrome);
    vi.stubGlobal("crypto", { randomUUID: () => "preset-1" });

    await loadPopupModule();

    document.querySelector<HTMLButtonElement>("#clear-values")!.click();

    const mappingSelect = document.querySelector<HTMLSelectElement>(".mapping-row select")!;
    mappingSelect.value = "";
    mappingSelect.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(500);

    const savedPreset = (mock.state.presets as FormPreset[])[0]!;
    expect(savedPreset.mappings ?? {}).toEqual({});
    expect(savedPreset.unmappedFieldIds ?? []).toEqual(["full_name"]);
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

    mock.chrome.runtime.sendMessage = (
      message: { type: string },
      callback: (response: unknown) => void,
    ) => {
      if (message.type === "GET_ACTIVE_FORM_CONTEXT") {
        callback({
          ok: true,
          data: {
            status: "unsupported_only",
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
    };

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

  it("keeps an unsaved mapping choice when toggling to no profile and back", async () => {
    const profiles: Profile[] = [
      {
        id: "profile-1",
        name: "Alpha",
        values: {
          fullName: "Alice",
          email: "alice@example.com",
        },
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
    mappingSelect.value = "email";
    mappingSelect.dispatchEvent(new Event("change", { bubbles: true }));

    const profileSelect = document.querySelector<HTMLSelectElement>("#profile-select")!;
    profileSelect.value = "";
    profileSelect.dispatchEvent(new Event("change", { bubbles: true }));
    profileSelect.value = "profile-1";
    profileSelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(document.querySelector<HTMLSelectElement>(".mapping-row select")!.value).toBe("email");
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

  it("keeps a cleared dropdown empty across profile switches and reopen", async () => {
    const profiles: Profile[] = [
      {
        id: "profile-1",
        name: "Alpha",
        values: { department: "CSE" },
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "profile-2",
        name: "Beta",
        values: { department: "EEE" },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const activeForm: ActiveFormContext = {
      title: "Department Form",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "department-form",
      fields: [
        {
          id: "department",
          label: "Department",
          normalizedLabel: "department",
          type: "dropdown",
          required: true,
          options: ["CSE", "EEE"],
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

    const initialFieldSelect = document.querySelector<HTMLElement>('[data-field-id="department"]')!
      .querySelectorAll<HTMLSelectElement>("select")[0]!;
    expect(initialFieldSelect.value).toBe("CSE");

    initialFieldSelect.value = "";
    initialFieldSelect.dispatchEvent(new Event("change", { bubbles: true }));

    const profileSelect = document.querySelector<HTMLSelectElement>("#profile-select")!;
    profileSelect.value = "profile-2";
    profileSelect.dispatchEvent(new Event("change", { bubbles: true }));

    const switchedFieldSelect = document.querySelector<HTMLElement>('[data-field-id="department"]')!
      .querySelectorAll<HTMLSelectElement>("select")[0]!;
    expect(switchedFieldSelect.value).toBe("");

    await vi.advanceTimersByTimeAsync(500);
    expect((mock.state.presets as FormPreset[])[0]).toMatchObject({
      unmappedFieldIds: ["department"],
      mappingSchemaVersion: 2,
    });

    document.documentElement.innerHTML = popupHtml;
    await loadPopupModule();

    const reopenedFieldSelect = document.querySelector<HTMLElement>('[data-field-id="department"]')!
      .querySelectorAll<HTMLSelectElement>("select")[0]!;
    expect(reopenedFieldSelect.value).toBe("");
    expect(document.querySelector<HTMLSelectElement>(".mapping-row select")!.value).toBe("");
  });

  it("filters placeholder dropdown options and does not restore them as valid values", async () => {
    const activeForm: ActiveFormContext = {
      title: "Department Form",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "department-form",
      fields: [
        {
          id: "department",
          label: "Department",
          normalizedLabel: "department",
          type: "dropdown",
          required: true,
          options: ["Choose", "CSE", "EEE"],
        },
      ],
    };

    const preset: FormPreset = {
      id: "preset-1",
      formKey: "department-form",
      name: "Department Form",
      formTitle: "Department Form",
      formUrl: activeForm.url,
      fields: activeForm.fields,
      values: { department: "Choose" },
      mappings: {},
      unmappedFieldIds: [],
      mappingSchemaVersion: 2,
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
    vi.stubGlobal("crypto", { randomUUID: () => "preset-1" });

    await loadPopupModule();

    const fieldSelect = document.querySelector<HTMLElement>('[data-field-id="department"]')!
      .querySelectorAll<HTMLSelectElement>("select")[0]!;
    const optionLabels = Array.from(fieldSelect.options).map((option) => option.textContent);

    expect(optionLabels).toEqual(["Select an option", "CSE", "EEE"]);
    expect(fieldSelect.value).toBe("");
  });

  it("renders scale fields as rating choices instead of a select", async () => {
    const activeForm: ActiveFormContext = {
      title: "Rating Form",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "rating-form",
      fields: [
        {
          id: "rating",
          label: "Rating Star",
          normalizedLabel: "rating star",
          type: "scale",
          required: true,
          options: ["1", "2", "3", "4", "5"],
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

    const field = document.querySelector<HTMLElement>('[data-field-id="rating"]')!;
    expect(field.querySelector("select")).toBeNull();
    expect(field.querySelectorAll('.rating-item input[type="radio"]')).toHaveLength(5);
    expect((field.querySelector<HTMLElement>(".rating-scale")!).style.getPropertyValue("--rating-columns")).toBe("5");
    expect(Array.from(field.querySelectorAll<HTMLElement>(".rating-item-value")).map((node) => node.textContent)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
  });

  it("does not rerender the scale field when selecting a rating", async () => {
    const activeForm: ActiveFormContext = {
      title: "Rating Form",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "rating-form",
      fields: [
        {
          id: "rating",
          label: "Rating Love",
          normalizedLabel: "rating love",
          type: "scale",
          required: true,
          options: ["1", "2", "3", "4", "5"],
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

    const field = document.querySelector<HTMLElement>('[data-field-id="rating"]')!;
    const thirdOption = field.querySelector<HTMLInputElement>('.rating-item input[type="radio"][value="3"]')!;

    thirdOption.checked = true;
    thirdOption.dispatchEvent(new Event("change", { bubbles: true }));

    const fieldAfterChange = document.querySelector<HTMLElement>('[data-field-id="rating"]')!;
    const thirdOptionAfterChange = fieldAfterChange.querySelector<HTMLInputElement>('.rating-item input[type="radio"][value="3"]')!;
    const activeValues = Array.from(fieldAfterChange.querySelectorAll<HTMLElement>(".rating-item.is-active")).map(
      (item) => item.dataset.optionValue,
    );

    expect(fieldAfterChange).toBe(field);
    expect(thirdOptionAfterChange).toBe(thirdOption);
    expect(thirdOptionAfterChange.checked).toBe(true);
    expect(activeValues).toEqual(["1", "2", "3"]);
  });

  it("renders linear scales as plain radio rows with bound labels", async () => {
    const activeForm: ActiveFormContext = {
      title: "Linear Scale Form",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "linear-scale-form",
      fields: [
        {
          id: "excitement",
          label: "Linear scale",
          normalizedLabel: "linear scale",
          type: "scale",
          required: true,
          options: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
          scaleLowLabel: "Not excited",
          scaleHighLabel: "Extremely excited",
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

    const field = document.querySelector<HTMLElement>('[data-field-id="excitement"]')!;
    expect(field.querySelector(".rating-scale")).toBeNull();
    expect(field.querySelector(".linear-scale")).toBeTruthy();
    expect((field.querySelector<HTMLElement>(".linear-scale")!).style.getPropertyValue("--linear-columns")).toBe("5");
    expect(field.querySelectorAll('.linear-scale-item input[type="radio"]')).toHaveLength(10);
    expect(Array.from(field.querySelectorAll<HTMLElement>(".linear-scale-value")).map((node) => node.textContent)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
    ]);
    expect(field.querySelector(".linear-scale-bound-start")).toBeNull();
    expect(field.querySelector(".linear-scale-bound-end")).toBeNull();
  });

  it("drops stale hidden mappings for fields that are no longer in the form", async () => {
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
      values: {},
      mappings: { old_field: "fullName" },
      unmappedFieldIds: ["old_field"],
      mappingSchemaVersion: 2,
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
    vi.stubGlobal("crypto", { randomUUID: () => "preset-1" });

    await loadPopupModule();

    const input = document.querySelector<HTMLInputElement>('#fields input[type="text"]')!;
    input.value = "Manual Name";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    const savedPreset = (mock.state.presets as FormPreset[])[0]!;
    expect(savedPreset.values).toEqual({ full_name: "Manual Name" });
    expect(savedPreset.mappings ?? {}).toEqual({});
    expect(savedPreset.unmappedFieldIds ?? []).toEqual([]);
  });

  it("does not restore an incompatible preset value when unmapping a profile-backed field", async () => {
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

    const preset: FormPreset = {
      id: "preset-1",
      formKey: "popup-form",
      name: "Registration",
      formTitle: "Registration",
      formUrl: activeForm.url,
      fields: activeForm.fields,
      values: { full_name: ["Math", "Physics"] },
      mappings: { full_name: "fullName" },
      mappingSchemaVersion: 2,
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

    expect(document.querySelector<HTMLInputElement>('#fields input[type="text"]')!.value).toBe("Alice");

    const mappingSelect = document.querySelector<HTMLSelectElement>(".mapping-row select")!;
    mappingSelect.value = "";
    mappingSelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(document.querySelector<HTMLInputElement>('#fields input[type="text"]')!.value).toBe("");

    await vi.advanceTimersByTimeAsync(500);

    const savedPreset = (mock.state.presets as FormPreset[])[0]!;
    expect(savedPreset.values).toEqual({});
    expect(savedPreset.unmappedFieldIds ?? []).toEqual(["full_name"]);
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

  it("keeps Other text when checkbox selections change afterward", async () => {
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

    const otherInput = document.querySelector<HTMLInputElement>(".other-text-input")!;
    otherInput.value = "Biology";
    otherInput.dispatchEvent(new Event("input", { bubbles: true }));

    const rerenderedCheckboxes = Array.from(document.querySelectorAll<HTMLInputElement>('#fields input[type="checkbox"]'));
    rerenderedCheckboxes[0]!.click();

    await vi.advanceTimersByTimeAsync(500);

    expect((mock.state.presets as FormPreset[])[0]!.values.topics).toEqual({
      kind: "choice_with_other",
      selected: ["Other", "Math"],
      otherText: "Biology",
    });
  });

  it("preserves field list scroll position when selecting a checkbox Other option", async () => {
    const activeForm: ActiveFormContext = {
      title: "Preferences",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "checkbox-form",
      fields: Array.from({ length: 12 }, (_, index) => ({
        id: index === 11 ? "topics" : `field_${index}`,
        label: index === 11 ? "Topics" : `Question ${index + 1}`,
        normalizedLabel: index === 11 ? "topics" : `question ${index + 1}`,
        type: index === 11 ? "checkbox" : "text",
        required: false,
        ...(index === 11 ? { options: ["Math", "Other", "Physics"], otherOption: "Other" } : {}),
      })) as ActiveFormContext["fields"],
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

    const fieldList = document.querySelector<HTMLDivElement>("#fields")!;
    fieldList.scrollTop = 180;

    const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('#fields input[type="checkbox"]'));
    checkboxes[1]!.click();

    expect(document.querySelector(".other-text-input")).toBeTruthy();
    expect(fieldList.scrollTop).toBe(180);
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

    expect((mock.state.presets as FormPreset[])[0]).toMatchObject({
      unmappedFieldIds: ["full_name"],
      mappingSchemaVersion: 2,
    });

    vi.resetModules();
    document.documentElement.innerHTML = popupHtml;
    await loadPopupModule();

    expect(document.querySelector<HTMLSelectElement>(".mapping-row select")!.value).toBe("");
  });

  it("allows mapping to a real profile key named __no_mapping__", async () => {
    const profiles: Profile[] = [
      {
        id: "profile-1",
        name: "Alpha",
        values: {
          __no_mapping__: "Alice",
        },
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
    mappingSelect.value = "__no_mapping__";
    mappingSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    expect(document.querySelector<HTMLInputElement>('#fields input[type="text"]')!.value).toBe("Alice");
    expect((mock.state.presets as FormPreset[])[0]).toMatchObject({
      mappings: { full_name: "__no_mapping__" },
      mappingSchemaVersion: 2,
    });
    expect((mock.state.presets as FormPreset[])[0].unmappedFieldIds ?? []).toEqual([]);
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
    const releaseFillSave = releaseStorageWrite as (() => void) | null;
    if (releaseFillSave) {
      releaseFillSave();
    }
    await vi.waitFor(() => {
      expect(fillMessageSent).toBe(true);
    });
  });

  it("rolls back an in-flight autosave when the popup is cleared", async () => {
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
        sendMessage(message: { type: string }, callback: (response: unknown) => void) {
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
    });
    vi.stubGlobal("crypto", { randomUUID: () => "preset-1" });

    await loadPopupModule();

    const input = document.querySelector<HTMLInputElement>('#fields input[type="text"]')!;
    input.value = "Manual Name";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(500);
    document.querySelector<HTMLButtonElement>("#clear-values")!.click();

    const releaseClearSave = releaseStorageWrite as (() => void) | null;
    if (releaseClearSave) {
      releaseClearSave();
    }
    await vi.waitFor(() => {
      expect((state.presets as FormPreset[] | undefined) ?? []).toEqual([]);
    });
    expect(document.querySelector<HTMLInputElement>('#fields input[type="text"]')!.value).toBe("");
    expect(document.querySelector<HTMLButtonElement>("#reset-preset")!.disabled).toBe(true);
  });

  it("does not restore a pre-clear autosave over newer edits made after clearing", async () => {
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
        sendMessage(message: { type: string }, callback: (response: unknown) => void) {
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
    });
    vi.stubGlobal("crypto", { randomUUID: () => "preset-1" });

    await loadPopupModule();

    const firstInput = document.querySelector<HTMLInputElement>('#fields input[type="text"]')!;
    firstInput.value = "Old Name";
    firstInput.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(500);
    document.querySelector<HTMLButtonElement>("#clear-values")!.click();

    const clearedInput = document.querySelector<HTMLInputElement>('#fields input[type="text"]')!;
    clearedInput.value = "New Name";
    clearedInput.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    const releasePendingSave = releaseStorageWrite as (() => void) | null;
    if (releasePendingSave) {
      releasePendingSave();
    }

    await vi.waitFor(() => {
      expect((state.presets as FormPreset[])[0]?.values.full_name).toBe("New Name");
    });
  });

  it("does not send blank popup values to the form filler", async () => {
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

    let fillPayload: Record<string, unknown> | null = null;
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

    mock.chrome.runtime.sendMessage = (
      message: { type: string; payload?: { values?: Record<string, unknown> } },
      callback: (response: unknown) => void,
    ) => {
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
        fillPayload = message.payload?.values ?? null;
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
    };

    vi.stubGlobal("chrome", mock.chrome);
    vi.stubGlobal("crypto", { randomUUID: () => "preset-1" });

    await loadPopupModule();

    const input = document.querySelector<HTMLInputElement>('#fields input[type="text"]')!;
    input.value = "Manual Name";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    document.querySelector<HTMLButtonElement>("#fill-form")!.click();
    await vi.waitFor(() => {
      expect(fillPayload).toEqual({});
    });
  });

  it("ignores incompatible saved mappings for the current field type", async () => {
    const profiles: Profile[] = [
      {
        id: "profile-1",
        name: "Alpha",
        values: { topics: ["Math", "Physics"] },
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
      values: {},
      mappings: { full_name: "topics" },
      mappingSchemaVersion: 2,
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

    expect(document.querySelector(".mapping-row")).toBeNull();
    expect(document.querySelector<HTMLInputElement>('#fields input[type="text"]')!.value).toBe("");
  });

  it("ignores incompatible preset values for the current field type", async () => {
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
      values: { full_name: ["Math", "Physics"] },
      mappingSchemaVersion: 2,
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
    vi.stubGlobal("crypto", { randomUUID: () => "preset-1" });

    await loadPopupModule();

    expect(document.querySelector<HTMLInputElement>('#fields input[type="text"]')!.value).toBe("");
  });

  it("maps unmatched checkbox profile values through the Other option", async () => {
    const profiles: Profile[] = [
      {
        id: "profile-1",
        name: "Alpha",
        values: { topicPreference: "Biology" },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const activeForm: ActiveFormContext = {
      title: "Preferences",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "checkbox-other-form",
      fields: [
        {
          id: "topics",
          label: "Topics",
          normalizedLabel: "topics",
          type: "checkbox",
          required: false,
          options: ["Math", "Other"],
          otherOption: "Other",
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
    mappingSelect.value = "topicPreference";
    mappingSelect.dispatchEvent(new Event("change", { bubbles: true }));

    const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('#fields input[type="checkbox"]'));
    expect(checkboxes[1]!.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>(".other-text-input")!.value).toBe("Biology");
  });

  it("does not offer invalid date values as mappable profile keys", async () => {
    const profiles: Profile[] = [
      {
        id: "profile-1",
        name: "Alpha",
        values: {
          invalidBirthday: "tomorrow",
          validBirthday: "2026-04-05",
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const activeForm: ActiveFormContext = {
      title: "Registration",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "date-form",
      fields: [
        {
          id: "birthday",
          label: "Birthday",
          normalizedLabel: "birthday",
          type: "date",
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
    expect(Array.from(mappingSelect.options).some((option) => option.value === "invalidBirthday")).toBe(false);
    expect(Array.from(mappingSelect.options).some((option) => option.value === "validBirthday")).toBe(true);
  });

  it("does not treat a raw Other profile value as a valid radio mapping", async () => {
    const profiles: Profile[] = [
      {
        id: "profile-1",
        name: "Alpha",
        values: {
          batchChoice: "Other",
          validBatchOther: "18",
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const activeForm: ActiveFormContext = {
      title: "Batch Form",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "radio-other-form",
      fields: [
        {
          id: "batch",
          label: "Batch",
          normalizedLabel: "batch",
          type: "radio",
          required: true,
          options: ["17", "16", "Other"],
          otherOption: "Other",
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
    expect(Array.from(mappingSelect.options).some((option) => option.value === "batchChoice")).toBe(false);
    expect(Array.from(mappingSelect.options).some((option) => option.value === "validBatchOther")).toBe(true);
    expect(mappingSelect.value).toBe("");
  });

  it("renders multiple choice grids as separate row groups and hides mapping controls", async () => {
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
      title: "Matrix Form",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "matrix-form",
      fields: [
        {
          id: "availability_grid",
          label: "Availability",
          normalizedLabel: "availability",
          type: "grid",
          required: false,
          options: ["Morning", "Afternoon"],
          gridRows: ["Monday", "Tuesday"],
          gridMode: "radio",
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

    expect(document.querySelector(".grid-group-list")).toBeTruthy();
    expect(Array.from(document.querySelectorAll<HTMLElement>(".grid-group-label")).map((node) => node.textContent)).toEqual([
      "Monday",
      "Tuesday",
    ]);
    expect(document.querySelectorAll('.grid-stacked-option input[type="radio"]')).toHaveLength(4);
    expect(Array.from(document.querySelectorAll<HTMLElement>(".grid-stacked-option-label")).map((node) => node.textContent)).toEqual([
      "Morning",
      "Afternoon",
      "Morning",
      "Afternoon",
    ]);
    expect(document.querySelector(".mapping-row")).toBeNull();
  });

  it("allows selecting the same column in different multiple choice grid rows", async () => {
    const activeForm: ActiveFormContext = {
      title: "Matrix Form",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "matrix-form",
      fields: [
        {
          id: "availability_grid",
          label: "Availability",
          normalizedLabel: "availability",
          type: "grid",
          required: false,
          options: ["Morning", "Afternoon"],
          gridRows: ["Monday", "Tuesday"],
          gridMode: "radio",
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

    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('.grid-stacked-option input[type="radio"]'));
    radios[0]!.checked = true;
    radios[0]!.dispatchEvent(new Event("change", { bubbles: true }));
    radios[2]!.checked = true;
    radios[2]!.dispatchEvent(new Event("change", { bubbles: true }));

    expect(radios[0]!.checked).toBe(true);
    expect(radios[2]!.checked).toBe(true);
  });

  it("keeps grid selections independent even when row labels repeat", async () => {
    const activeForm: ActiveFormContext = {
      title: "Matrix Form",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "matrix-form",
      fields: [
        {
          id: "availability_grid",
          label: "Availability",
          normalizedLabel: "availability",
          type: "grid",
          required: false,
          options: ["Column 1", "Column 2"],
          gridRows: ["Row", "Row"],
          gridRowIds: ["row-0", "row-1"],
          gridMode: "radio",
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

    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('.grid-stacked-option input[type="radio"]'));
    radios[0]!.checked = true;
    radios[0]!.dispatchEvent(new Event("change", { bubbles: true }));
    radios[3]!.checked = true;
    radios[3]!.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(500);

    expect((mock.state.presets as FormPreset[])[0]!.values.availability_grid).toEqual({
      kind: "grid",
      rows: {
        "row-0": "Column 1",
        "row-1": "Column 2",
      },
    });
  });

  it("shows a placeholder for textarea fields", async () => {
    const activeForm: ActiveFormContext = {
      title: "Essay Form",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "essay-form",
      fields: [
        {
          id: "essay",
          label: "Essay",
          normalizedLabel: "essay",
          type: "textarea",
          required: false,
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

    const textarea = document.querySelector<HTMLTextAreaElement>("#fields textarea")!;
    expect(textarea.placeholder).toBe("Your answer");
  });

  it("reapplies the mapped value after reverting a manual edit back to it", async () => {
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
    input.value = "Manual Name";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = "Alice";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const profileSelect = document.querySelector<HTMLSelectElement>("#profile-select")!;
    profileSelect.value = "profile-2";
    profileSelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(document.querySelector<HTMLInputElement>('#fields input[type="text"]')!.value).toBe("Bob");
    expect(document.querySelector<HTMLSelectElement>(".mapping-row select")!.value).toBe("fullName");
  });

  it("restores an auto-broken mapping after a profile switch when the value is reverted to the new mapped value", async () => {
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
    input.value = "Manual Name";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const profileSelect = document.querySelector<HTMLSelectElement>("#profile-select")!;
    profileSelect.value = "profile-2";
    profileSelect.dispatchEvent(new Event("change", { bubbles: true }));

    const switchedInput = document.querySelector<HTMLInputElement>('#fields input[type="text"]')!;
    switchedInput.value = "Bob";
    switchedInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(document.querySelector<HTMLSelectElement>(".mapping-row select")!.value).toBe("fullName");
  });

  it("restores the originally broken mapping key when reverting to its value", async () => {
    const profiles: Profile[] = [
      {
        id: "profile-1",
        name: "Alpha",
        values: { preferredName: "Alice", fullName: "Alice" },
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
      mappings: { full_name: "preferredName" },
      mappingSchemaVersion: 2,
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

    const input = document.querySelector<HTMLInputElement>('#fields input[type="text"]')!;
    input.value = "Manual Name";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = "Alice";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(document.querySelector<HTMLSelectElement>(".mapping-row select")!.value).toBe("preferredName");
  });

  it("stores a preset mapping snapshot even if the mapping changes before the write finishes", async () => {
    const profiles: Profile[] = [
      {
        id: "profile-1",
        name: "Alpha",
        values: { fullName: "Alice", email: "alice@example.com" },
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

    let firstWrittenPreset: FormPreset | null = null;
    let releaseStorageWrite: (() => void) | null = null;
    const state: Record<string, unknown> = {
      profiles,
      presets: [],
      settings: {
        defaultProfileId: "profile-1",
        autoLoadMatchingProfile: true,
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
            if ("presets" in value && releaseStorageWrite === null) {
              firstWrittenPreset = structuredClone((value.presets as FormPreset[])[0]!);
              Object.assign(state, value);
              releaseStorageWrite = callback;
              return;
            }

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
        sendMessage(message: { type: string }, callback: (response: unknown) => void) {
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
    });
    vi.stubGlobal("crypto", { randomUUID: () => "preset-1" });

    await loadPopupModule();

    const mappingSelect = document.querySelector<HTMLSelectElement>(".mapping-row select")!;
    mappingSelect.value = "fullName";
    mappingSelect.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(500);

    mappingSelect.value = "email";
    mappingSelect.dispatchEvent(new Event("change", { bubbles: true }));

    const capturedPreset = firstWrittenPreset as FormPreset | null;
    expect(capturedPreset?.mappings?.full_name).toBe("fullName");

    const releasePendingSave = releaseStorageWrite as (() => void) | null;
    if (releasePendingSave) {
      releasePendingSave();
    }
  });

  it("deletes a brand-new preset if a later autosave clears it before the first write finishes", async () => {
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
        sendMessage(message: { type: string }, callback: (response: unknown) => void) {
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
    });
    vi.stubGlobal("crypto", { randomUUID: () => "preset-1" });

    await loadPopupModule();

    const input = document.querySelector<HTMLInputElement>('#fields input[type="text"]')!;
    input.value = "Manual Name";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    const releasePendingSave = releaseStorageWrite as (() => void) | null;
    if (releasePendingSave) {
      releasePendingSave();
    }

    await vi.waitFor(() => {
      expect((state.presets as FormPreset[] | undefined) ?? []).toEqual([]);
    });
  });

  it("reuses the pending preset id after Clear so a new edit does not create duplicate presets", async () => {
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

    let releaseFirstSave: (() => void) | null = null;
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
            if ("presets" in value && releaseFirstSave === null) {
              releaseFirstSave = callback;
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
        sendMessage(message: { type: string }, callback: (response: unknown) => void) {
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
    });

    let idCounter = 0;
    vi.stubGlobal("crypto", {
      randomUUID: () => `preset-${++idCounter}`,
    });

    await loadPopupModule();

    const input = document.querySelector<HTMLInputElement>('#fields input[type="text"]')!;
    input.value = "First Name";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    document.querySelector<HTMLButtonElement>("#clear-values")!.click();

    const clearedInput = document.querySelector<HTMLInputElement>('#fields input[type="text"]')!;
    clearedInput.value = "Second Name";
    clearedInput.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    const releasePendingFirstSave = releaseFirstSave as (() => void) | null;
    if (releasePendingFirstSave) {
      releasePendingFirstSave();
    }

    await vi.waitFor(() => {
      const presets = (state.presets as FormPreset[] | undefined) ?? [];
      expect(presets).toHaveLength(1);
      expect(presets[0]).toMatchObject({
        id: "preset-1",
        values: { full_name: "Second Name" },
      });
    });
  });

  it("does not autosave or fill an incomplete Other selection", async () => {
    const activeForm: ActiveFormContext = {
      title: "Department Form",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "radio-other-form",
      fields: [
        {
          id: "department",
          label: "Department",
          normalizedLabel: "department",
          type: "radio",
          required: true,
          options: ["CSE", "Other"],
          otherOption: "Other",
        },
      ],
    };

    let fillPayload: Record<string, unknown> | null = null;
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

    mock.chrome.runtime.sendMessage = (
      message: { type: string; payload?: { values?: Record<string, unknown> } },
      callback: (response: unknown) => void,
    ) => {
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
        fillPayload = message.payload?.values ?? null;
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
    };

    vi.stubGlobal("chrome", mock.chrome);
    vi.stubGlobal("crypto", { randomUUID: () => "preset-1" });

    await loadPopupModule();

    const otherRadio = Array.from(document.querySelectorAll<HTMLInputElement>('#fields input[type="radio"]')).find(
      (input) => input.value === "Other",
    )!;
    otherRadio.checked = true;
    otherRadio.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    expect((mock.state.presets as FormPreset[] | undefined) ?? []).toEqual([]);

    document.querySelector<HTMLButtonElement>("#fill-form")!.click();
    await vi.waitFor(() => {
      expect(fillPayload).toEqual({});
    });
  });

  it("renders radio fields as radio inputs instead of a select", async () => {
    const activeForm: ActiveFormContext = {
      title: "Department Form",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "radio-render-form",
      fields: [
        {
          id: "department",
          label: "Department",
          normalizedLabel: "department",
          type: "radio",
          required: true,
          options: ["CSE", "EEE", "Other"],
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

    expect(document.querySelector('#fields select')).toBeNull();
    expect(document.querySelectorAll('#fields input[type="radio"]')).toHaveLength(3);
  });

  it("does not rerender the field list for ordinary radio selection changes", async () => {
    const activeForm: ActiveFormContext = {
      title: "Department Form",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "radio-scroll-form",
      fields: [
        {
          id: "department",
          label: "Department",
          normalizedLabel: "department",
          type: "radio",
          required: true,
          options: ["CSE", "EEE", "Other"],
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

    const fieldList = document.querySelector<HTMLDivElement>("#fields")!;
    fieldList.scrollTop = 120;

    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('#fields input[type="radio"]'));
    const eeeRadio = radios.find((input) => input.value === "EEE")!;

    eeeRadio.checked = true;
    eeeRadio.dispatchEvent(new Event("change", { bubbles: true }));

    expect(eeeRadio.isConnected).toBe(true);
    expect(fieldList.scrollTop).toBe(120);
    expect(document.querySelector(".other-text-input")).toBeNull();
  });

  it("shows grid-only forms as editable matrices instead of unsupported", async () => {
    const activeForm: ActiveFormContext = {
      title: "Availability Form",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "grid-only-form",
      fields: [
        {
          id: "availability",
          label: "Availability",
          normalizedLabel: "availability",
          type: "grid",
          required: false,
          options: ["Morning", "Afternoon"],
          gridRows: ["Monday"],
          gridMode: "radio",
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

    mock.chrome.runtime.sendMessage = (
      message: { type: string },
      callback: (response: unknown) => void,
    ) => {
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
    };

    vi.stubGlobal("chrome", mock.chrome);
    vi.stubGlobal("crypto", { randomUUID: () => "preset-1" });

    await loadPopupModule();

    expect(document.querySelector<HTMLHeadingElement>("#form-title")!.textContent).toBe("Availability Form");
    expect(document.querySelector(".grid-group-list")).toBeTruthy();
    expect(document.querySelectorAll('.grid-stacked-option input[type="radio"]')).toHaveLength(2);
    expect(document.querySelector<HTMLDivElement>("#error-card")!.classList.contains("hidden")).toBe(true);
    expect(document.querySelector<HTMLDivElement>("#status-card")!.classList.contains("hidden")).toBe(true);
  });

  it("renders checkbox grids as separate row groups", async () => {
    const activeForm: ActiveFormContext = {
      title: "Preferences Form",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "checkbox-grid-form",
      fields: [
        {
          id: "preferences",
          label: "Preferences",
          normalizedLabel: "preferences",
          type: "grid",
          required: false,
          options: ["A", "B"],
          gridRows: ["Row 1", "Row 2"],
          gridMode: "checkbox",
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

    expect(document.querySelector(".grid-group-list")).toBeTruthy();
    expect(Array.from(document.querySelectorAll<HTMLElement>(".grid-group-label")).map((node) => node.textContent)).toEqual([
      "Row 1",
      "Row 2",
    ]);
    expect(document.querySelectorAll('.grid-stacked-option input[type="checkbox"]')).toHaveLength(4);
    expect(Array.from(document.querySelectorAll<HTMLElement>(".grid-stacked-option-label")).map((node) => node.textContent)).toEqual([
      "A",
      "B",
      "A",
      "B",
    ]);
  });

  it("renders radio grids as separate row radio groups", async () => {
    const activeForm: ActiveFormContext = {
      title: "Matrix Form",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-popup/viewform",
      formKey: "radio-grid-form",
      fields: [
        {
          id: "availability",
          label: "Availability",
          normalizedLabel: "availability",
          type: "grid",
          required: false,
          options: ["Column 1", "Column 2"],
          gridRows: ["Row 1", "Row 2"],
          gridMode: "radio",
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

    const groups = Array.from(document.querySelectorAll<HTMLElement>(".grid-group"));
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.querySelector(".grid-group-label")?.textContent)).toEqual(["Row 1", "Row 2"]);
    expect(groups.map((group) => group.querySelectorAll('input[type="radio"]').length)).toEqual([2, 2]);
    expect(groups.map((group) => Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]')).map((input) => input.name))).toEqual([
      ["popup-grid-availability-row-0", "popup-grid-availability-row-0"],
      ["popup-grid-availability-row-1", "popup-grid-availability-row-1"],
    ]);
    expect(groups.map((group) => Array.from(group.querySelectorAll<HTMLElement>(".grid-stacked-option-label")).map((node) => node.textContent))).toEqual([
      ["Column 1", "Column 2"],
      ["Column 1", "Column 2"],
    ]);
  });

  it("refuses to fill when the active tab changed to a different form", async () => {
    const initialForm: ActiveFormContext = {
      title: "Form A",
      url: "https://docs.google.com/forms/d/e/1FAIpQLS-form-a/viewform",
      formKey: "form-a",
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
      __activeForm: initialForm,
    });

    mock.chrome.runtime.sendMessage = (
      message: { type: string; payload?: { formKey?: string } },
      callback: (response: unknown) => void,
    ) => {
      if (message.type === "GET_ACTIVE_FORM_CONTEXT") {
        callback({
          ok: true,
          data: {
            status: "ready",
            context: initialForm,
          },
        });
        return;
      }

      if (message.type === "FILL_ACTIVE_FORM") {
        callback({
          ok: false,
          error: "The active tab changed to a different Google Form. Reopen the popup on the current form and try again.",
        });
        return;
      }

      callback({ ok: false, error: "Unknown message" });
    };

    vi.stubGlobal("chrome", mock.chrome);
    vi.stubGlobal("crypto", { randomUUID: () => "preset-1" });

    await loadPopupModule();

    document.querySelector<HTMLButtonElement>("#fill-form")!.click();

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLDivElement>("#status-card")!.textContent).toBe(
        "The active tab changed to a different Google Form. Reopen the popup on the current form and try again.",
      );
    });
  });
});

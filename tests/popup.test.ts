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

    const mappingSelect = document.querySelector<HTMLSelectElement>(".mapping-row select")!;
    expect(Array.from(mappingSelect.options).some((option) => option.value === "topics")).toBe(false);
    expect(mappingSelect.value).toBe("");
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

  it("shows unsupported fields as disabled and hides mapping controls", async () => {
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
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe("This field type is not supported yet");
    expect(document.querySelector(".mapping-row")).toBeNull();
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

    const select = document.querySelector<HTMLSelectElement>('#fields select')!;
    select.value = "Other";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    expect((mock.state.presets as FormPreset[] | undefined) ?? []).toEqual([]);

    document.querySelector<HTMLButtonElement>("#fill-form")!.click();
    await vi.waitFor(() => {
      expect(fillPayload).toEqual({});
    });
  });

  it("shows unsupported grid-only forms instead of treating them as unreadable", async () => {
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

    expect(document.querySelector<HTMLHeadingElement>("#form-title")!.textContent).toBe("Availability Form");
    expect(document.querySelector<HTMLInputElement>('#fields input[type="text"]')!.disabled).toBe(true);
    expect(document.querySelector<HTMLDivElement>("#error-card")!.classList.contains("hidden")).toBe(true);
    expect(document.querySelector<HTMLDivElement>("#status-card")!.textContent).toBe(
      "This form was scanned, but only unsupported field types were detected.",
    );
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

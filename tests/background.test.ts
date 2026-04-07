import type { BackgroundRequest } from "../src/core/types";

type BackgroundListener = (
  message: BackgroundRequest,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

function tabWithUrl(url: string, id = 7): chrome.tabs.Tab {
  return {
    active: true,
    audible: false,
    autoDiscardable: true,
    discarded: false,
    favIconUrl: "",
    frozen: false,
    groupId: -1,
    height: 0,
    highlighted: true,
    id,
    incognito: false,
    index: 0,
    mutedInfo: { muted: false },
    pinned: false,
    selected: true,
    status: "complete",
    title: "",
    url,
    width: 0,
    windowId: 1,
  };
}

function textField() {
  return {
    id: "field-1",
    label: "Name",
    normalizedLabel: "name",
    type: "text" as const,
    required: false,
  };
}

async function loadBackgroundWithChrome(chromeMock: unknown): Promise<BackgroundListener> {
  vi.resetModules();
  const addListener = vi.fn();
  vi.stubGlobal("chrome", {
    ...(chromeMock as Record<string, unknown>),
    runtime: {
      ...((chromeMock as { runtime?: Record<string, unknown> }).runtime ?? {}),
      onMessage: {
        addListener,
      },
    },
  });

  await import("../src/features/background/main");
  const listener = addListener.mock.calls[0]?.[0] as BackgroundListener | undefined;
  if (!listener) {
    throw new Error("Background listener was not registered");
  }

  return listener;
}

describe("background", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scans with an already-ready content script when the expected manifest version is unavailable", async () => {
    const executeScript = vi.fn();
    const listener = await loadBackgroundWithChrome({
      tabs: {
        query(_queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) {
          callback([tabWithUrl("https://docs.google.com/forms/d/e/form-id/viewform")]);
        },
        sendMessage(_tabId: number, message: { type: string }, callback: (response: unknown) => void) {
          if (message.type === "PING") {
            callback({ ok: true, data: { ready: true, version: null } });
            return;
          }

          callback({
            ok: true,
            data: {
              formKey: "form-id",
              title: "Test form",
              url: "https://docs.google.com/forms/d/e/form-id/viewform",
              fields: [textField()],
            },
          });
        },
      },
      scripting: {
        executeScript,
      },
    });
    const sendResponse = vi.fn();

    expect(listener({ type: "GET_ACTIVE_FORM_CONTEXT" }, {}, sendResponse)).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        data: {
          status: "ready",
          pageUrl: "https://docs.google.com/forms/d/e/form-id/viewform",
          context: {
            formKey: "form-id",
            title: "Test form",
            url: "https://docs.google.com/forms/d/e/form-id/viewform",
            fields: [textField()],
          },
        },
      });
    });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("returns a clear error for malformed background messages", async () => {
    const query = vi.fn();
    const listener = await loadBackgroundWithChrome({
      tabs: {
        query,
      },
      scripting: {
        executeScript: vi.fn(),
      },
    });
    const sendResponse = vi.fn();

    expect(listener(null as unknown as BackgroundRequest, {}, sendResponse)).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: "Malformed background message",
      });
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns a clear error for malformed fill requests before scanning", async () => {
    const query = vi.fn();
    const listener = await loadBackgroundWithChrome({
      tabs: {
        query,
      },
      scripting: {
        executeScript: vi.fn(),
      },
    });
    const sendResponse = vi.fn();

    expect(listener({ type: "FILL_ACTIVE_FORM" } as unknown as BackgroundRequest, {}, sendResponse)).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: "Malformed background message",
      });
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns a clear error for malformed fill values before scanning", async () => {
    const query = vi.fn();
    const listener = await loadBackgroundWithChrome({
      tabs: {
        query,
      },
      scripting: {
        executeScript: vi.fn(),
      },
    });
    const sendResponse = vi.fn();

    expect(
      listener(
        {
          type: "FILL_ACTIVE_FORM",
          payload: {
            formKey: "form-1",
            values: {
              "field-1": { nested: true },
            },
          },
        } as unknown as BackgroundRequest,
        {},
        sendResponse,
      ),
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: "Malformed background message",
      });
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns a clear error for malformed storage mutation requests", async () => {
    const listener = await loadBackgroundWithChrome({
      tabs: {
        query: vi.fn(),
      },
      scripting: {
        executeScript: vi.fn(),
      },
    });
    const sendResponse = vi.fn();

    expect(
      listener(
        {
          type: "RUN_STORAGE_MUTATION",
          payload: { kind: "save_profile" },
        } as unknown as BackgroundRequest,
        {},
        sendResponse,
      ),
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: "Malformed background message",
      });
    });
  });

  it("returns a clear error for malformed storage mutation record payloads", async () => {
    const listener = await loadBackgroundWithChrome({
      tabs: {
        query: vi.fn(),
      },
      scripting: {
        executeScript: vi.fn(),
      },
    });
    const sendResponse = vi.fn();

    expect(
      listener(
        {
          type: "RUN_STORAGE_MUTATION",
          payload: {
            kind: "save_settings",
            settings: {
              defaultProfileId: null,
              autoLoadMatchingProfile: "yes",
              confirmBeforeFill: true,
              showBackupSection: false,
            },
          },
        } as unknown as BackgroundRequest,
        {},
        sendResponse,
      ),
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: "Malformed background message",
      });
    });
  });

  it("returns a clear error for malformed import mutation payloads", async () => {
    const listener = await loadBackgroundWithChrome({
      tabs: {
        query: vi.fn(),
      },
      scripting: {
        executeScript: vi.fn(),
      },
    });
    const sendResponse = vi.fn();

    expect(
      listener(
        {
          type: "RUN_STORAGE_MUTATION",
          payload: {
            kind: "import_app_data",
            data: {
              version: 1,
              profiles: [
                {
                  id: "profile-1",
                  name: "Broken",
                  values: { fullName: { nested: true } },
                  createdAt: 1,
                  updatedAt: 1,
                },
              ],
            },
          },
        } as unknown as BackgroundRequest,
        {},
        sendResponse,
      ),
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: "Malformed background message",
      });
    });
  });

  it("treats tab id 0 as a valid active tab", async () => {
    const sendMessage = vi.fn((_tabId: number, message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "PING") {
        callback({ ok: true, data: { ready: true, version: null } });
        return;
      }

      callback({
        ok: true,
        data: {
          formKey: "form-id",
          title: "Test form",
          url: "https://docs.google.com/forms/d/e/form-id/viewform",
          fields: [textField()],
        },
      });
    });
    const listener = await loadBackgroundWithChrome({
      tabs: {
        query(_queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) {
          callback([tabWithUrl("https://docs.google.com/forms/d/e/form-id/viewform", 0)]);
        },
        sendMessage,
      },
      scripting: {
        executeScript: vi.fn(),
      },
    });
    const sendResponse = vi.fn();

    expect(listener({ type: "GET_ACTIVE_FORM_CONTEXT" }, {}, sendResponse)).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({ status: "ready" }),
        }),
      );
    });
    expect(sendMessage).toHaveBeenCalledWith(0, { type: "PING" }, expect.any(Function));
  });

  it("does not scan Google Forms editor response routes as live forms", async () => {
    const sendMessage = vi.fn();
    const executeScript = vi.fn();
    const listener = await loadBackgroundWithChrome({
      tabs: {
        query(_queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) {
          callback([tabWithUrl("https://docs.google.com/forms/d/abc123/edit#responses")]);
        },
        sendMessage,
      },
      scripting: {
        executeScript,
      },
    });
    const sendResponse = vi.fn();

    expect(listener({ type: "GET_ACTIVE_FORM_CONTEXT" }, {}, sendResponse)).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        data: {
          status: "invalid_url",
          pageUrl: "https://docs.google.com/forms/d/abc123/edit#responses",
        },
      });
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("does not scan non-Forms docs.google.com viewform paths as live forms", async () => {
    const sendMessage = vi.fn();
    const executeScript = vi.fn();
    const listener = await loadBackgroundWithChrome({
      tabs: {
        query(_queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) {
          callback([tabWithUrl("https://docs.google.com/document/d/example/viewform")]);
        },
        sendMessage,
      },
      scripting: {
        executeScript,
      },
    });
    const sendResponse = vi.fn();

    expect(listener({ type: "GET_ACTIVE_FORM_CONTEXT" }, {}, sendResponse)).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        data: {
          status: "invalid_url",
          pageUrl: "https://docs.google.com/document/d/example/viewform",
        },
      });
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("does not scan malformed Forms viewform paths as live forms", async () => {
    const sendMessage = vi.fn();
    const executeScript = vi.fn();
    const listener = await loadBackgroundWithChrome({
      tabs: {
        query(_queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) {
          callback([tabWithUrl("https://docs.google.com/forms/not-a-form-id/viewform")]);
        },
        sendMessage,
      },
      scripting: {
        executeScript,
      },
    });
    const sendResponse = vi.fn();

    expect(listener({ type: "GET_ACTIVE_FORM_CONTEXT" }, {}, sendResponse)).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        data: {
          status: "invalid_url",
          pageUrl: "https://docs.google.com/forms/not-a-form-id/viewform",
        },
      });
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("allows account-prefixed Google Forms viewform routes as live forms", async () => {
    const sendMessage = vi.fn((_tabId: number, message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "PING") {
        callback({ ok: true, data: { ready: true, version: null } });
        return;
      }

      callback({
        ok: true,
        data: {
          formKey: "form-id",
          title: "Test form",
          url: "https://docs.google.com/forms/u/0/d/e/form-id/viewform",
          fields: [textField()],
        },
      });
    });
    const listener = await loadBackgroundWithChrome({
      tabs: {
        query(_queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) {
          callback([tabWithUrl("https://docs.google.com/forms/u/0/d/e/form-id/viewform")]);
        },
        sendMessage,
      },
      scripting: {
        executeScript: vi.fn(),
      },
    });
    const sendResponse = vi.fn();

    expect(listener({ type: "GET_ACTIVE_FORM_CONTEXT" }, {}, sendResponse)).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({ status: "ready" }),
        }),
      );
    });
  });

  it("allows Google Forms formResponse routes as live forms", async () => {
    const sendMessage = vi.fn((_tabId: number, message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "PING") {
        callback({ ok: true, data: { ready: true, version: null } });
        return;
      }

      callback({
        ok: true,
        data: {
          formKey: "form-id",
          title: "Test form",
          url: "https://docs.google.com/forms/d/e/form-id/formResponse",
          fields: [textField()],
        },
      });
    });
    const listener = await loadBackgroundWithChrome({
      tabs: {
        query(_queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) {
          callback([tabWithUrl("https://docs.google.com/forms/d/e/form-id/formResponse")]);
        },
        sendMessage,
      },
      scripting: {
        executeScript: vi.fn(),
      },
    });
    const sendResponse = vi.fn();

    expect(listener({ type: "GET_ACTIVE_FORM_CONTEXT" }, {}, sendResponse)).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({ status: "ready" }),
        }),
      );
    });
  });

  it("rejects a ready content script without a matching version when the manifest version is known", async () => {
    const executeScript = vi.fn();
    const listener = await loadBackgroundWithChrome({
      runtime: {
        getManifest() {
          return { version: "1.2.3" };
        },
      },
      tabs: {
        query(_queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) {
          callback([tabWithUrl("https://docs.google.com/forms/d/e/form-id/viewform")]);
        },
        sendMessage(_tabId: number, _message: { type: string }, callback: (response: unknown) => void) {
          callback({ ok: true, data: { ready: true, version: null } });
        },
      },
      scripting: {
        executeScript,
      },
    });
    const sendResponse = vi.fn();

    expect(listener({ type: "GET_ACTIVE_FORM_CONTEXT" }, {}, sendResponse)).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: "Reload the Google Form tab to use the latest extension code, then open Fillo again.",
      });
    });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("verifies the content script after injecting it before scanning", async () => {
    const executeScript = vi.fn((_options: chrome.scripting.ScriptInjection<unknown[], unknown>, callback: () => void) => {
      callback();
    });
    const sendMessage = vi.fn((_tabId: number, message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "PING" && sendMessage.mock.calls.length === 1) {
        callback({ ok: false, error: "No receiving end" });
        return;
      }

      if (message.type === "PING") {
        callback({ ok: true, data: { ready: true, version: null } });
        return;
      }

      callback({
        ok: true,
        data: {
          formKey: "form-id",
          title: "Test form",
          url: "https://docs.google.com/forms/d/e/form-id/viewform",
          fields: [textField()],
        },
      });
    });
    const listener = await loadBackgroundWithChrome({
      tabs: {
        query(_queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) {
          callback([tabWithUrl("https://docs.google.com/forms/d/e/form-id/viewform")]);
        },
        sendMessage,
      },
      scripting: {
        executeScript,
      },
    });
    const sendResponse = vi.fn();

    expect(listener({ type: "GET_ACTIVE_FORM_CONTEXT" }, {}, sendResponse)).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({ status: "ready" }),
        }),
      );
    });
    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });

  it("returns the reload message when the injected content script still does not respond", async () => {
    const executeScript = vi.fn((_options: chrome.scripting.ScriptInjection<unknown[], unknown>, callback: () => void) => {
      callback();
    });
    const listener = await loadBackgroundWithChrome({
      tabs: {
        query(_queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) {
          callback([tabWithUrl("https://docs.google.com/forms/d/e/form-id/viewform")]);
        },
        sendMessage(_tabId: number, _message: { type: string }, callback: (response: unknown) => void) {
          callback({ ok: false, error: "No receiving end" });
        },
      },
      scripting: {
        executeScript,
      },
    });
    const sendResponse = vi.fn();

    expect(listener({ type: "GET_ACTIVE_FORM_CONTEXT" }, {}, sendResponse)).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: "Reload the Google Form tab to use the latest extension code, then open Fillo again.",
      });
    });
    expect(executeScript).toHaveBeenCalledTimes(1);
  });

  it("returns a clear error when a scan response is missing data", async () => {
    const listener = await loadBackgroundWithChrome({
      tabs: {
        query(_queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) {
          callback([tabWithUrl("https://docs.google.com/forms/d/e/form-id/viewform")]);
        },
        sendMessage(_tabId: number, message: { type: string }, callback: (response: unknown) => void) {
          if (message.type === "PING") {
            callback({ ok: true, data: { ready: true, version: null } });
            return;
          }

          callback({ ok: true });
        },
      },
      scripting: {
        executeScript: vi.fn(),
      },
    });
    const sendResponse = vi.fn();

    expect(listener({ type: "GET_ACTIVE_FORM_CONTEXT" }, {}, sendResponse)).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: "Content script response was missing data",
      });
    });
  });

  it("returns a clear error when a scan response is malformed", async () => {
    const listener = await loadBackgroundWithChrome({
      tabs: {
        query(_queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) {
          callback([tabWithUrl("https://docs.google.com/forms/d/e/form-id/viewform")]);
        },
        sendMessage(_tabId: number, message: { type: string }, callback: (response: unknown) => void) {
          if (message.type === "PING") {
            callback({ ok: true, data: { ready: true, version: null } });
            return;
          }

          callback({ ok: true, data: { title: "Test form", formKey: "form-id" } });
        },
      },
      scripting: {
        executeScript: vi.fn(),
      },
    });
    const sendResponse = vi.fn();

    expect(listener({ type: "GET_ACTIVE_FORM_CONTEXT" }, {}, sendResponse)).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: "Content script scan response was malformed",
      });
    });
  });

  it("returns a clear error when a scan response has malformed fields", async () => {
    const listener = await loadBackgroundWithChrome({
      tabs: {
        query(_queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) {
          callback([tabWithUrl("https://docs.google.com/forms/d/e/form-id/viewform")]);
        },
        sendMessage(_tabId: number, message: { type: string }, callback: (response: unknown) => void) {
          if (message.type === "PING") {
            callback({ ok: true, data: { ready: true, version: null } });
            return;
          }

          callback({
            ok: true,
            data: {
              formKey: "form-id",
              title: "Test form",
              url: "https://docs.google.com/forms/d/e/form-id/viewform",
              fields: [{ id: "field-1", label: "Name", type: "unsupported", required: false }],
            },
          });
        },
      },
      scripting: {
        executeScript: vi.fn(),
      },
    });
    const sendResponse = vi.fn();

    expect(listener({ type: "GET_ACTIVE_FORM_CONTEXT" }, {}, sendResponse)).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: "Content script scan response was malformed",
      });
    });
  });

  it("returns a clear error when scanned fields use inherited properties", async () => {
    const inheritedField = Object.create(textField());
    const listener = await loadBackgroundWithChrome({
      tabs: {
        query(_queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) {
          callback([tabWithUrl("https://docs.google.com/forms/d/e/form-id/viewform")]);
        },
        sendMessage(_tabId: number, message: { type: string }, callback: (response: unknown) => void) {
          if (message.type === "PING") {
            callback({ ok: true, data: { ready: true, version: null } });
            return;
          }

          callback({
            ok: true,
            data: {
              formKey: "form-id",
              title: "Test form",
              url: "https://docs.google.com/forms/d/e/form-id/viewform",
              fields: [inheritedField],
            },
          });
        },
      },
      scripting: {
        executeScript: vi.fn(),
      },
    });
    const sendResponse = vi.fn();

    expect(listener({ type: "GET_ACTIVE_FORM_CONTEXT" }, {}, sendResponse)).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: "Content script scan response was malformed",
      });
    });
  });

  it("returns a clear error when scanned option-backed fields are missing options", async () => {
    const listener = await loadBackgroundWithChrome({
      tabs: {
        query(_queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) {
          callback([tabWithUrl("https://docs.google.com/forms/d/e/form-id/viewform")]);
        },
        sendMessage(_tabId: number, message: { type: string }, callback: (response: unknown) => void) {
          if (message.type === "PING") {
            callback({ ok: true, data: { ready: true, version: null } });
            return;
          }

          callback({
            ok: true,
            data: {
              formKey: "form-id",
              title: "Test form",
              url: "https://docs.google.com/forms/d/e/form-id/viewform",
              fields: [
                {
                  id: "rating",
                  label: "Rating",
                  normalizedLabel: "rating",
                  type: "scale",
                  required: false,
                },
              ],
            },
          });
        },
      },
      scripting: {
        executeScript: vi.fn(),
      },
    });
    const sendResponse = vi.fn();

    expect(listener({ type: "GET_ACTIVE_FORM_CONTEXT" }, {}, sendResponse)).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: "Content script scan response was malformed",
      });
    });
  });

  it("returns a clear error when a fill response is malformed", async () => {
    const sendMessage = vi.fn((_tabId: number, message: { type: string }, callback: (response: unknown) => void) => {
      if (message.type === "PING") {
        callback({ ok: true, data: { ready: true, version: null } });
        return;
      }

      if (message.type === "SCAN_FORM") {
        callback({
          ok: true,
          data: {
            formKey: "form-id",
            title: "Test form",
            url: "https://docs.google.com/forms/d/e/form-id/viewform",
            fields: [textField()],
          },
        });
        return;
      }

      callback({ ok: true, data: { filledFieldIds: ["field-1"], skippedFieldIds: [42] } });
    });
    const listener = await loadBackgroundWithChrome({
      tabs: {
        query(_queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) {
          callback([tabWithUrl("https://docs.google.com/forms/d/e/form-id/viewform")]);
        },
        sendMessage,
      },
      scripting: {
        executeScript: vi.fn(),
      },
    });
    const sendResponse = vi.fn();

    expect(
      listener(
        {
          type: "FILL_ACTIVE_FORM",
          payload: {
            formKey: "form-id",
            values: { "field-1": "Toufiq" },
          },
        },
        {},
        sendResponse,
      ),
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: "Content script fill response was malformed",
      });
    });
    expect(sendMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: "FILL_FORM" }),
      expect.any(Function),
    );
  });
});

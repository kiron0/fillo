import {
  hasChromeRuntime,
  runtimeManifestVersion,
  runtimeOpenOptionsPage,
  runtimeSendMessage,
  storageGet,
  storageRemove,
  storageSet,
  scriptingExecuteScript,
  tabsQuery,
  tabsSendMessage,
} from "../src/core/chrome-api";

describe("chrome-api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects runtimeSendMessage when chrome.runtime exists without sendMessage", async () => {
    vi.stubGlobal("chrome", {
      runtime: {},
    });

    await expect(runtimeSendMessage({ type: "PING" })).rejects.toThrow("chrome.runtime is not available");
  });

  it("treats malformed truthy chrome.runtime values as unavailable", () => {
    vi.stubGlobal("chrome", {
      runtime: "broken",
    });

    expect(hasChromeRuntime()).toBe(false);
  });

  it("treats browser.runtime as an available extension runtime", () => {
    vi.stubGlobal("browser", {
      runtime: {},
    });

    expect(hasChromeRuntime()).toBe(true);
  });

  it("rejects runtimeOpenOptionsPage when chrome.runtime exists without openOptionsPage", async () => {
    vi.stubGlobal("chrome", {
      runtime: {},
    });

    await expect(runtimeOpenOptionsPage()).rejects.toThrow("chrome.runtime is not available");
  });

  it("uses browser.runtime.sendMessage when chrome is unavailable", async () => {
    vi.stubGlobal("browser", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ ok: true }),
      },
    });

    await expect(runtimeSendMessage({ type: "PING" })).resolves.toEqual({ ok: true });
  });

  it("rejects runtimeSendMessage when chrome.runtime.sendMessage throws synchronously", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage() {
          throw new Error("boom");
        },
      },
    });

    await expect(runtimeSendMessage({ type: "PING" })).rejects.toThrow("boom");
  });

  it("returns null when chrome.runtime.getManifest throws synchronously", () => {
    vi.stubGlobal("chrome", {
      runtime: {
        getManifest() {
          throw new Error("boom");
        },
      },
    });

    expect(runtimeManifestVersion()).toBeNull();
  });

  it("returns null when chrome.runtime.getManifest().version is not a string", () => {
    vi.stubGlobal("chrome", {
      runtime: {
        getManifest() {
          return { version: 42 };
        },
      },
    });

    expect(runtimeManifestVersion()).toBeNull();
  });

  it("rejects tabsQuery when chrome.tabs.query throws synchronously", async () => {
    vi.stubGlobal("chrome", {
      runtime: {},
      tabs: {
        query() {
          throw new Error("boom");
        },
      },
    });

    await expect(tabsQuery({ active: true })).rejects.toThrow("boom");
  });

  it("uses browser.tabs.query when chrome is unavailable", async () => {
    vi.stubGlobal("browser", {
      runtime: {},
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, active: true }]),
      },
    });

    await expect(tabsQuery({ active: true })).resolves.toEqual([{ id: 1, active: true }]);
  });

  it("rejects tabsQuery when chrome.tabs exists without query", async () => {
    vi.stubGlobal("chrome", {
      runtime: {},
      tabs: {},
    });

    await expect(tabsQuery({ active: true })).rejects.toThrow("chrome.tabs.query is not available");
  });

  it("normalizes malformed tabsQuery callback results to an empty tab list", async () => {
    vi.stubGlobal("chrome", {
      runtime: {},
      tabs: {
        query(_queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[] | undefined) => void) {
          callback(undefined);
        },
      },
    });

    await expect(tabsQuery({ active: true })).resolves.toEqual([]);
  });

  it("rejects tabsSendMessage when chrome.tabs.sendMessage throws synchronously", async () => {
    vi.stubGlobal("chrome", {
      runtime: {},
      tabs: {
        sendMessage() {
          throw new Error("boom");
        },
      },
    });

    await expect(tabsSendMessage(1, { type: "PING" })).rejects.toThrow("boom");
  });

  it("rejects tabsSendMessage when chrome.tabs exists without sendMessage", async () => {
    vi.stubGlobal("chrome", {
      runtime: {},
      tabs: {},
    });

    await expect(tabsSendMessage(1, { type: "PING" })).rejects.toThrow("chrome.tabs.sendMessage is not available");
  });

  it("rejects scriptingExecuteScript when chrome.scripting.executeScript throws synchronously", async () => {
    vi.stubGlobal("chrome", {
      runtime: {},
      scripting: {
        executeScript() {
          throw new Error("boom");
        },
      },
    });

    await expect(
      scriptingExecuteScript({
        target: { tabId: 1 },
        files: ["content/index.js"],
      }),
    ).rejects.toThrow("boom");
  });

  it("rejects scriptingExecuteScript when chrome.scripting exists without executeScript", async () => {
    vi.stubGlobal("chrome", {
      runtime: {},
      scripting: {},
    });

    await expect(
      scriptingExecuteScript({
        target: { tabId: 1 },
        files: ["content/index.js"],
      }),
    ).rejects.toThrow("chrome.scripting.executeScript is not available");
  });

  it("rejects storageGet when chrome.storage.local.get throws synchronously", async () => {
    vi.stubGlobal("chrome", {
      runtime: {},
      storage: {
        local: {
          get() {
            throw new Error("boom");
          },
        },
      },
    });

    await expect(storageGet(["profiles"])).rejects.toThrow("boom");
  });

  it("uses browser.storage.local.get when chrome is unavailable", async () => {
    vi.stubGlobal("browser", {
      runtime: {},
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ profiles: [] }),
        },
      },
    });

    await expect(storageGet(["profiles"])).resolves.toEqual({ profiles: [] });
  });

  it("rejects with a fallback message when chrome.runtime.lastError has no string message", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        lastError: { message: 42 },
      },
      storage: {
        local: {
          get(_keys: string[], callback: (result: Record<string, unknown>) => void) {
            callback({});
          },
        },
      },
    });

    await expect(storageGet(["profiles"])).rejects.toThrow("Chrome runtime error");
  });

  it("rejects storageGet when chrome.storage.local exists without get", async () => {
    vi.stubGlobal("chrome", {
      runtime: {},
      storage: {
        local: {},
      },
    });

    await expect(storageGet(["profiles"])).rejects.toThrow("chrome.storage.local is not available");
  });

  it("normalizes malformed storageGet callback results to an empty object", async () => {
    vi.stubGlobal("chrome", {
      runtime: {},
      storage: {
        local: {
          get(_keys: string[], callback: (result: Record<string, unknown> | undefined) => void) {
            callback(undefined);
          },
        },
      },
    });

    await expect(storageGet(["profiles"])).resolves.toEqual({});
  });

  it("normalizes array storageGet callback results to an empty object", async () => {
    vi.stubGlobal("chrome", {
      runtime: {},
      storage: {
        local: {
          get(_keys: string[], callback: (result: unknown) => void) {
            callback([]);
          },
        },
      },
    });

    await expect(storageGet(["profiles"])).resolves.toEqual({});
  });

  it("rejects storageSet when chrome.storage.local.set throws synchronously", async () => {
    vi.stubGlobal("chrome", {
      runtime: {},
      storage: {
        local: {
          set() {
            throw new Error("boom");
          },
        },
      },
    });

    await expect(storageSet({ profiles: [] })).rejects.toThrow("boom");
  });

  it("rejects storageSet when chrome.storage.local exists without set", async () => {
    vi.stubGlobal("chrome", {
      runtime: {},
      storage: {
        local: {},
      },
    });

    await expect(storageSet({ profiles: [] })).rejects.toThrow("chrome.storage.local is not available");
  });

  it("rejects storageRemove when chrome.storage.local.remove throws synchronously", async () => {
    vi.stubGlobal("chrome", {
      runtime: {},
      storage: {
        local: {
          remove() {
            throw new Error("boom");
          },
        },
      },
    });

    await expect(storageRemove(["profiles"])).rejects.toThrow("boom");
  });

  it("rejects storageRemove when chrome.storage.local exists without remove", async () => {
    vi.stubGlobal("chrome", {
      runtime: {},
      storage: {
        local: {},
      },
    });

    await expect(storageRemove(["profiles"])).rejects.toThrow("chrome.storage.local is not available");
  });
});

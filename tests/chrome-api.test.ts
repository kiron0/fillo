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

  it("rejects runtimeOpenOptionsPage when chrome.runtime exists without openOptionsPage", async () => {
    vi.stubGlobal("chrome", {
      runtime: {},
    });

    await expect(runtimeOpenOptionsPage()).rejects.toThrow("chrome.runtime is not available");
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
});

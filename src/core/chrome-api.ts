type BrowserRuntimeApi = {
  lastError?: { message?: unknown };
  sendMessage?: (message: unknown) => Promise<unknown>;
  openOptionsPage?: () => Promise<void>;
  getManifest?: () => chrome.runtime.Manifest;
  onMessage?: {
    addListener: (listener: (...args: any[]) => unknown) => void;
  };
};

type BrowserStorageApi = {
  get?: (keys: string[]) => Promise<Record<string, unknown> | unknown>;
  set?: (value: Record<string, unknown>) => Promise<void>;
  remove?: (keys: string[]) => Promise<void>;
};

type BrowserTabsApi = {
  query?: (queryInfo: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>;
  sendMessage?: (tabId: number, message: unknown) => Promise<unknown>;
};

type BrowserScriptingApi = {
  executeScript?: (options: chrome.scripting.ScriptInjection<unknown[], unknown>) => Promise<unknown>;
};

type BrowserApi = {
  runtime?: BrowserRuntimeApi;
  storage?: { local?: BrowserStorageApi };
  tabs?: BrowserTabsApi;
  scripting?: BrowserScriptingApi;
};

type ExtensionApi =
  | { kind: "browser"; api: BrowserApi }
  | { kind: "chrome"; api: typeof chrome };

type GlobalExtensionApis = typeof globalThis & {
  browser?: BrowserApi;
  chrome?: typeof chrome;
};

function getGlobalExtensionApis(): GlobalExtensionApis {
  return globalThis as GlobalExtensionApis;
}

function getExtensionApi(): ExtensionApi | null {
  const globals = getGlobalExtensionApis();
  if (typeof globals.browser === "object" && globals.browser !== null) {
    return { kind: "browser", api: globals.browser };
  }

  if (typeof globals.chrome === "object" && globals.chrome !== null) {
    return { kind: "chrome", api: globals.chrome };
  }

  return null;
}

function normalizeError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

function normalizeStorageResult<T extends Record<string, unknown>>(result: unknown): T {
  return (result && typeof result === "object" && !Array.isArray(result) ? result : {}) as T;
}

export function hasExtensionRuntime(): boolean {
  const runtime = getExtensionApi()?.api.runtime;
  return typeof runtime === "object" && runtime !== null;
}

export function hasChromeRuntime(): boolean {
  return hasExtensionRuntime();
}

function getLastErrorMessage(): string | null {
  const lastError = getExtensionApi()?.api.runtime?.lastError;
  if (!lastError) {
    return null;
  }

  return typeof lastError.message === "string" ? lastError.message : "Chrome runtime error";
}

export function addRuntimeMessageListener<TMessage>(
  listener: (
    message: TMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => boolean | void,
): void {
  const runtime = getExtensionApi()?.api.runtime;
  if (!runtime?.onMessage || typeof runtime.onMessage.addListener !== "function") {
    throw new Error("chrome.runtime.onMessage is not available");
  }

  runtime.onMessage.addListener(listener as (...args: any[]) => unknown);
}

export function storageGet<T extends Record<string, unknown>>(keys: string[]): Promise<T> {
  const extensionApi = getExtensionApi();
  const storageApi = extensionApi?.api.storage?.local;
  if (!extensionApi || !storageApi?.get) {
    return Promise.reject(new Error("chrome.storage.local is not available"));
  }

  if (extensionApi.kind === "browser") {
    return storageApi.get(keys).then(
      (result) => normalizeStorageResult<T>(result),
      (error) => {
        throw normalizeError(error, "chrome.storage.local.get failed");
      },
    );
  }

  return new Promise((resolve, reject) => {
    try {
      const get = extensionApi.api.storage?.local?.get;
      if (typeof get !== "function") {
        reject(new Error("chrome.storage.local is not available"));
        return;
      }

      get(keys, (result) => {
        const error = getLastErrorMessage();
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve(normalizeStorageResult<T>(result));
      });
    } catch (error) {
      reject(normalizeError(error, "chrome.storage.local.get failed"));
    }
  });
}

export function storageSet(value: Record<string, unknown>): Promise<void> {
  const extensionApi = getExtensionApi();
  const storageApi = extensionApi?.api.storage?.local;
  if (!extensionApi || !storageApi?.set) {
    return Promise.reject(new Error("chrome.storage.local is not available"));
  }

  if (extensionApi.kind === "browser") {
    return storageApi.set(value).catch((error) => {
      throw normalizeError(error, "chrome.storage.local.set failed");
    });
  }

  return new Promise((resolve, reject) => {
    try {
      const set = extensionApi.api.storage?.local?.set;
      if (typeof set !== "function") {
        reject(new Error("chrome.storage.local is not available"));
        return;
      }

      set(value, () => {
        const error = getLastErrorMessage();
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(normalizeError(error, "chrome.storage.local.set failed"));
    }
  });
}

export function storageRemove(keys: string[]): Promise<void> {
  const extensionApi = getExtensionApi();
  const storageApi = extensionApi?.api.storage?.local;
  if (!extensionApi || !storageApi?.remove) {
    return Promise.reject(new Error("chrome.storage.local is not available"));
  }

  if (extensionApi.kind === "browser") {
    return storageApi.remove(keys).catch((error) => {
      throw normalizeError(error, "chrome.storage.local.remove failed");
    });
  }

  return new Promise((resolve, reject) => {
    try {
      const remove = extensionApi.api.storage?.local?.remove;
      if (typeof remove !== "function") {
        reject(new Error("chrome.storage.local is not available"));
        return;
      }

      remove(keys, () => {
        const error = getLastErrorMessage();
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(normalizeError(error, "chrome.storage.local.remove failed"));
    }
  });
}

export function runtimeSendMessage<T>(message: unknown): Promise<T> {
  const extensionApi = getExtensionApi();
  const runtime = extensionApi?.api.runtime;
  if (!extensionApi || !runtime?.sendMessage) {
    return Promise.reject(new Error("chrome.runtime is not available"));
  }

  if (extensionApi.kind === "browser") {
    return runtime.sendMessage(message).then(
      (response) => response as T,
      (error) => {
        throw normalizeError(error, "chrome.runtime.sendMessage failed");
      },
    );
  }

  return new Promise((resolve, reject) => {
    try {
      const sendMessage = extensionApi.api.runtime?.sendMessage;
      if (typeof sendMessage !== "function") {
        reject(new Error("chrome.runtime is not available"));
        return;
      }

      sendMessage(message, (response) => {
        const error = getLastErrorMessage();
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve(response as T);
      });
    } catch (error) {
      reject(normalizeError(error, "chrome.runtime.sendMessage failed"));
    }
  });
}

export function runtimeOpenOptionsPage(): Promise<void> {
  const extensionApi = getExtensionApi();
  const runtime = extensionApi?.api.runtime;
  if (!extensionApi || !runtime?.openOptionsPage) {
    return Promise.reject(new Error("chrome.runtime is not available"));
  }

  if (extensionApi.kind === "browser") {
    return runtime.openOptionsPage().catch((error) => {
      throw normalizeError(error, "chrome.runtime.openOptionsPage failed");
    });
  }

  return new Promise((resolve, reject) => {
    try {
      const openOptionsPage = extensionApi.api.runtime?.openOptionsPage;
      if (typeof openOptionsPage !== "function") {
        reject(new Error("chrome.runtime is not available"));
        return;
      }

      openOptionsPage(() => {
        const error = getLastErrorMessage();
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(normalizeError(error, "chrome.runtime.openOptionsPage failed"));
    }
  });
}

export function runtimeManifestVersion(): string | null {
  const runtime = getExtensionApi()?.api.runtime;
  if (!runtime?.getManifest) {
    return null;
  }

  try {
    const version = runtime.getManifest().version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

export function tabsQuery(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
  const extensionApi = getExtensionApi();
  const tabsApi = extensionApi?.api.tabs;
  if (!extensionApi || !tabsApi?.query) {
    return Promise.reject(new Error("chrome.tabs.query is not available"));
  }

  if (extensionApi.kind === "browser") {
    return tabsApi.query(queryInfo).then(
      (tabs) => (Array.isArray(tabs) ? tabs : []),
      (error) => {
        throw normalizeError(error, "chrome.tabs.query failed");
      },
    );
  }

  return new Promise((resolve, reject) => {
    try {
      const query = extensionApi.api.tabs?.query;
      if (typeof query !== "function") {
        reject(new Error("chrome.tabs.query is not available"));
        return;
      }

      query(queryInfo, (tabs) => {
        const error = getLastErrorMessage();
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve(Array.isArray(tabs) ? tabs : []);
      });
    } catch (error) {
      reject(normalizeError(error, "chrome.tabs.query failed"));
    }
  });
}

export function tabsSendMessage<T>(tabId: number, message: unknown): Promise<T> {
  const extensionApi = getExtensionApi();
  const tabsApi = extensionApi?.api.tabs;
  if (!extensionApi || !tabsApi?.sendMessage) {
    return Promise.reject(new Error("chrome.tabs.sendMessage is not available"));
  }

  if (extensionApi.kind === "browser") {
    return tabsApi.sendMessage(tabId, message).then(
      (response) => response as T,
      (error) => {
        throw normalizeError(error, "chrome.tabs.sendMessage failed");
      },
    );
  }

  return new Promise((resolve, reject) => {
    try {
      const sendMessage = extensionApi.api.tabs?.sendMessage;
      if (typeof sendMessage !== "function") {
        reject(new Error("chrome.tabs.sendMessage is not available"));
        return;
      }

      sendMessage(tabId, message, (response) => {
        const error = getLastErrorMessage();
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve(response as T);
      });
    } catch (error) {
      reject(normalizeError(error, "chrome.tabs.sendMessage failed"));
    }
  });
}

export function scriptingExecuteScript(options: chrome.scripting.ScriptInjection<unknown[], unknown>): Promise<void> {
  const extensionApi = getExtensionApi();
  const scriptingApi = extensionApi?.api.scripting;
  if (!extensionApi || !scriptingApi?.executeScript) {
    return Promise.reject(new Error("chrome.scripting.executeScript is not available"));
  }

  if (extensionApi.kind === "browser") {
    return scriptingApi.executeScript(options).then(
      () => undefined,
      (error) => {
        throw normalizeError(error, "chrome.scripting.executeScript failed");
      },
    );
  }

  return new Promise((resolve, reject) => {
    try {
      const executeScript = extensionApi.api.scripting?.executeScript;
      if (typeof executeScript !== "function") {
        reject(new Error("chrome.scripting.executeScript is not available"));
        return;
      }

      executeScript(options, () => {
        const error = getLastErrorMessage();
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(normalizeError(error, "chrome.scripting.executeScript failed"));
    }
  });
}

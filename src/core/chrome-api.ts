export function hasChromeRuntime(): boolean {
  return (
    typeof chrome !== "undefined" &&
    typeof chrome.runtime === "object" &&
    chrome.runtime !== null
  );
}

function getLastErrorMessage(): string | null {
  const lastError = chrome.runtime?.lastError;
  if (!lastError) {
    return null;
  }

  return typeof lastError.message === "string"
    ? lastError.message
    : "Chrome runtime error";
}

export function storageGet<T extends Record<string, unknown>>(keys: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || typeof chrome.storage?.local?.get !== "function") {
      reject(new Error("chrome.storage.local is not available"));
      return;
    }

    try {
      chrome.storage.local.get(keys, (result) => {
        const error = getLastErrorMessage();
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve((result && typeof result === "object" ? result : {}) as T);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error("chrome.storage.local.get failed"));
    }
  });
}

export function storageSet(value: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || typeof chrome.storage?.local?.set !== "function") {
      reject(new Error("chrome.storage.local is not available"));
      return;
    }

    try {
      chrome.storage.local.set(value, () => {
        const error = getLastErrorMessage();
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error("chrome.storage.local.set failed"));
    }
  });
}

export function storageRemove(keys: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || typeof chrome.storage?.local?.remove !== "function") {
      reject(new Error("chrome.storage.local is not available"));
      return;
    }

    try {
      chrome.storage.local.remove(keys, () => {
        const error = getLastErrorMessage();
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error("chrome.storage.local.remove failed"));
    }
  });
}

export function runtimeSendMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!hasChromeRuntime() || typeof chrome.runtime.sendMessage !== "function") {
      reject(new Error("chrome.runtime is not available"));
      return;
    }

    try {
      chrome.runtime.sendMessage(message, (response) => {
        const error = getLastErrorMessage();
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve(response as T);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error("chrome.runtime.sendMessage failed"));
    }
  });
}

export function runtimeOpenOptionsPage(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!hasChromeRuntime() || typeof chrome.runtime.openOptionsPage !== "function") {
      reject(new Error("chrome.runtime is not available"));
      return;
    }

    try {
      chrome.runtime.openOptionsPage(() => {
        const error = getLastErrorMessage();
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error("chrome.runtime.openOptionsPage failed"));
    }
  });
}

export function runtimeManifestVersion(): string | null {
  if (!hasChromeRuntime() || typeof chrome.runtime.getManifest !== "function") {
    return null;
  }

  try {
    const version = chrome.runtime.getManifest().version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

export function tabsQuery(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || typeof chrome.tabs?.query !== "function") {
      reject(new Error("chrome.tabs.query is not available"));
      return;
    }

    try {
      chrome.tabs.query(queryInfo, (tabs) => {
        const error = getLastErrorMessage();
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve(Array.isArray(tabs) ? tabs : []);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error("chrome.tabs.query failed"));
    }
  });
}

export function tabsSendMessage<T>(tabId: number, message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || typeof chrome.tabs?.sendMessage !== "function") {
      reject(new Error("chrome.tabs.sendMessage is not available"));
      return;
    }

    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const error = getLastErrorMessage();
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve(response as T);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error("chrome.tabs.sendMessage failed"));
    }
  });
}

export function scriptingExecuteScript(options: chrome.scripting.ScriptInjection<unknown[], unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || typeof chrome.scripting?.executeScript !== "function") {
      reject(new Error("chrome.scripting.executeScript is not available"));
      return;
    }

    try {
      chrome.scripting.executeScript(options, () => {
        const error = getLastErrorMessage();
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error("chrome.scripting.executeScript failed"));
    }
  });
}

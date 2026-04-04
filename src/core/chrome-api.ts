export function hasChromeRuntime(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime);
}

function getLastErrorMessage(): string | null {
  return chrome.runtime?.lastError?.message ?? null;
}

export function storageGet<T extends Record<string, unknown>>(keys: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      reject(new Error("chrome.storage.local is not available"));
      return;
    }

    chrome.storage.local.get(keys, (result) => {
      const error = getLastErrorMessage();
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve(result as T);
    });
  });
}

export function storageSet(value: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      reject(new Error("chrome.storage.local is not available"));
      return;
    }

    chrome.storage.local.set(value, () => {
      const error = getLastErrorMessage();
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve();
    });
  });
}

export function storageRemove(keys: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      reject(new Error("chrome.storage.local is not available"));
      return;
    }

    chrome.storage.local.remove(keys, () => {
      const error = getLastErrorMessage();
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve();
    });
  });
}

export function runtimeSendMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!hasChromeRuntime()) {
      reject(new Error("chrome.runtime is not available"));
      return;
    }

    chrome.runtime.sendMessage(message, (response) => {
      const error = getLastErrorMessage();
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve(response as T);
    });
  });
}

export function runtimeOpenOptionsPage(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!hasChromeRuntime()) {
      reject(new Error("chrome.runtime is not available"));
      return;
    }

    chrome.runtime.openOptionsPage(() => {
      const error = getLastErrorMessage();
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve();
    });
  });
}

export function tabsQuery(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.tabs?.query) {
      reject(new Error("chrome.tabs.query is not available"));
      return;
    }

    chrome.tabs.query(queryInfo, (tabs) => {
      const error = getLastErrorMessage();
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve(tabs);
    });
  });
}

export function tabsSendMessage<T>(tabId: number, message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.tabs?.sendMessage) {
      reject(new Error("chrome.tabs.sendMessage is not available"));
      return;
    }

    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = getLastErrorMessage();
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve(response as T);
    });
  });
}

export function scriptingExecuteScript(options: chrome.scripting.ScriptInjection<unknown[], unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.scripting?.executeScript) {
      reject(new Error("chrome.scripting.executeScript is not available"));
      return;
    }

    chrome.scripting.executeScript(options, () => {
      const error = getLastErrorMessage();
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve();
    });
  });
}

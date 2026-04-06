import { runtimeManifestVersion } from "../../core/chrome-api";
import { fillFormDocumentAsync, scanFormDocument } from "./form-dom";
import type { ContentRequest, MessageResponse } from "../../core/types";

function respond<T>(data: T): MessageResponse<T> {
  return { ok: true, data };
}

function respondError(error: unknown): MessageResponse<never> {
  return { ok: false, error: error instanceof Error ? error.message : "Unknown content-script error" };
}

chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
  switch (message.type) {
    case "PING":
      sendResponse(respond({ ready: true, version: runtimeManifestVersion() }));
      return false;
    case "SCAN_FORM":
      try {
        sendResponse(respond(scanFormDocument(document)));
      } catch (error) {
        sendResponse(respondError(error));
      }
      return false;
    case "FILL_FORM":
      void fillFormDocumentAsync(document, message.payload)
        .then((result) => sendResponse(respond(result)))
        .catch((error) => sendResponse(respondError(error)));
      return true;
    default:
      sendResponse(respondError(new Error("Unsupported content-script message")));
      return false;
  }
});

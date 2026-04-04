import { fillFormDocument, scanFormDocument } from "./form-dom";
import type { ContentRequest, MessageResponse } from "../../core/types";

function respond<T>(data: T): MessageResponse<T> {
  return { ok: true, data };
}

function respondError(error: unknown): MessageResponse<never> {
  return { ok: false, error: error instanceof Error ? error.message : "Unknown content-script error" };
}

chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
  try {
    switch (message.type) {
      case "PING":
        sendResponse(respond({ ready: true }));
        return false;
      case "SCAN_FORM":
        sendResponse(respond(scanFormDocument(document)));
        return false;
      case "FILL_FORM":
        sendResponse(respond(fillFormDocument(document, message.payload)));
        return false;
      default:
        sendResponse(respondError(new Error("Unsupported content-script message")));
        return false;
    }
  } catch (error) {
    sendResponse(respondError(error));
    return false;
  }
});

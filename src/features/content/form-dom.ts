import { createFormKey } from "../../core/form-key";
import { normalizeText, optionEquals } from "../../core/normalization";
import type { ChoiceWithOtherValue, DetectedField, FieldType, FieldValue, FillRequest, FillResult, ScanResult } from "../../core/types";

type FieldDescriptor = {
  field: DetectedField;
  container: HTMLElement;
  control: HTMLElement;
  type: FieldType;
};

function isVisible(element: Element): boolean {
  const node = element as HTMLElement;
  if (node.hidden) {
    return false;
  }

  const style = window.getComputedStyle(node);
  return style.display !== "none" && style.visibility !== "hidden";
}

function textContent(element: Element | null): string {
  return normalizeText(element?.textContent ?? "");
}

function rawTextContent(element: Element | null | undefined): string {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function getChoiceLabel(node: HTMLElement): string {
  const direct = rawTextContent(node);
  if (direct) {
    return direct;
  }

  const ariaLabel = node.getAttribute("aria-label")?.trim();
  if (ariaLabel) {
    return ariaLabel;
  }

  const labelledBy = node.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => rawTextContent(document.getElementById(id)))
      .filter(Boolean);
    if (parts.length) {
      return parts.join(" ");
    }
  }

  const selectors = [
    '[data-value]',
    '.aDTYNe',
    '.YEVVod',
    '.docssharedWizToggleLabeledLabelText',
    '.nWQGrd',
    'span',
    'label',
  ];

  for (const selector of selectors) {
    const candidate = rawTextContent(node.querySelector(selector));
    if (candidate) {
      return candidate;
    }
  }

  const role = node.getAttribute("role");
  let current = node.parentElement;
  while (current) {
    if (role) {
      const matchingChoices = Array.from(current.querySelectorAll<HTMLElement>(`[role="${role}"]`)).filter(isVisible);
      if (matchingChoices.length === 1 && matchingChoices[0] === node) {
        const candidate = rawTextContent(current);
        if (candidate) {
          return candidate;
        }
      }
    }

    current = current.parentElement;
  }

  return "";
}

function getQuestionContainers(root: Document): HTMLElement[] {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('[role="listitem"], .Qr7Oae')).filter((element) => isVisible(element));
  const seen = new Set(candidates);

  for (const checkbox of Array.from(root.querySelectorAll<HTMLElement>('[role="checkbox"]')).filter(isVisible)) {
    if (candidates.some((container) => container.contains(checkbox))) {
      continue;
    }

    const container = findVerifiedEmailContainer(checkbox);
    if (container && !seen.has(container)) {
      candidates.push(container);
      seen.add(container);
    }
  }

  return candidates.sort(compareDocumentOrder);
}

function looksLikeVerifiedEmailConsentContainer(container: HTMLElement): boolean {
  const text = rawTextContent(container);
  const checkboxCount = Array.from(container.querySelectorAll<HTMLElement>('[role="checkbox"]')).filter(isVisible).length;

  return (
    checkboxCount === 1 &&
    !container.querySelector('[role="radio"]') &&
    /^email\b/i.test(text) &&
    /record\b/i.test(text) &&
    /included with my response/i.test(text)
  );
}

function compareDocumentOrder(left: HTMLElement, right: HTMLElement): number {
  if (left === right) {
    return 0;
  }

  const position = left.compareDocumentPosition(right);
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
    return -1;
  }

  if (position & Node.DOCUMENT_POSITION_PRECEDING) {
    return 1;
  }

  return 0;
}

function findVerifiedEmailContainer(checkbox: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = checkbox;

  while (current) {
    if (looksLikeVerifiedEmailConsentContainer(current)) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function getQuestionLabel(container: HTMLElement): string {
  const selectors = [
    '[data-params] [role="heading"]',
    '[role="heading"]',
    '.M7eMe',
    '.HoXoMd',
    '.zHQkBf',
    '.freebirdFormviewerComponentsQuestionBaseTitle',
  ];

  for (const selector of selectors) {
    const element = container.querySelector(selector);
    const label = rawTextContent(element);
    if (label) {
      return label.replace(/\s+\*$/, "").trim();
    }
  }

  if (isVerifiedEmailConsentContainer(container)) {
    return "Email";
  }

  return "";
}

function getHelpText(container: HTMLElement): string | undefined {
  const selectors = [".gubaDc", ".freebirdFormviewerComponentsQuestionBaseDescription", '[role="note"]'];

  for (const selector of selectors) {
    const element = container.querySelector(selector);
    const value = rawTextContent(element);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function getSectionTitle(container: HTMLElement): string | undefined {
  const section = container.closest<HTMLElement>('[role="list"]')?.previousElementSibling;
  const title = rawTextContent(section);
  return title || undefined;
}

function isRequired(container: HTMLElement, label: string): boolean {
  return /\*$/.test(rawTextContent(container.querySelector('[role="heading"], .M7eMe')) ?? "") || label.endsWith("*") || isVerifiedEmailConsentContainer(container);
}

function isVerifiedEmailConsentContainer(container: HTMLElement): boolean {
  return looksLikeVerifiedEmailConsentContainer(container);
}

function getVerifiedEmailOptionLabel(container: HTMLElement): string {
  const fullText = rawTextContent(container);
  const optionText = fullText.replace(/^email\s*:?\s*\*?\s*/i, "").trim();
  return optionText || "Record email with my response";
}

function uniqueFieldId(container: HTMLElement, label: string, index: number): string {
  const explicitId =
    container.querySelector<HTMLElement>("input, textarea, select")?.getAttribute("name") ??
    container.querySelector<HTMLElement>("input, textarea, select")?.id ??
    container.getAttribute("data-item-id");

  return explicitId && explicitId.trim() ? explicitId.trim() : `${normalizeText(label).replace(/\s+/g, "_") || "field"}_${index}`;
}

function extractOptionsFromRoleNodes(nodes: HTMLElement[]): string[] {
  return nodes.map((node) => getChoiceLabel(node)).filter(Boolean);
}

function looksLikePlaceholderLabel(label: string): boolean {
  const normalized = normalizeText(label);
  return normalized === "choose" || normalized === "select" || normalized === "select an option" || normalized === "choose an option";
}

function isSelectableNativeOption(option: HTMLOptionElement, totalOptions: number): boolean {
  if (option.disabled) {
    return false;
  }

  if (option.value.trim().length > 0) {
    return !looksLikePlaceholderLabel(option.textContent?.trim() ?? "");
  }

  return totalOptions === 1;
}

function findVisibleTextControl(container: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null {
  const candidates = Array.from(
    container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input[type="text"], input[type="email"], input[type="number"], input[type="tel"], input[type="url"], textarea',
    ),
  );

  return candidates.find((candidate) => isVisible(candidate)) ?? null;
}

function findAttachedTextControl(
  node: HTMLElement,
  role: "radio" | "checkbox",
  boundary: HTMLElement,
): HTMLInputElement | HTMLTextAreaElement | null {
  let current = node.parentElement;

  while (current && current !== boundary) {
    const textControl = findVisibleTextControl(current);
    if (textControl) {
      const choices = Array.from(current.querySelectorAll<HTMLElement>(`[role="${role}"]`)).filter(isVisible);
      if (choices.length === 1 && choices[0] === node) {
        return textControl;
      }
    }
    current = current.parentElement;
  }

  return null;
}

function findSingleBoundaryTextControl(boundary: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null {
  const controls = Array.from(
    boundary.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input[type="text"], input[type="email"], input[type="number"], input[type="tel"], input[type="url"], textarea',
    ),
  ).filter(isVisible);

  return controls.length === 1 ? controls[0] : null;
}

function hasAttachedTextControl(node: HTMLElement, role: "radio" | "checkbox", boundary: HTMLElement): boolean {
  return Boolean(findAttachedTextControl(node, role, boundary));
}

function findAttachedOtherChoice(container: HTMLElement, role: "radio" | "checkbox"): HTMLElement | null {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(`[role="${role}"]`)).filter(isVisible);
  return nodes.find((node) => hasAttachedTextControl(node, role, container)) ?? null;
}

function detectOtherOptionLabel(
  options: string[],
  container: HTMLElement,
  role: "radio" | "checkbox",
): string | undefined {
  const explicitOther = options.find((option) => normalizeText(option) === "other");
  if (explicitOther) {
    return explicitOther;
  }

  return findAttachedOtherChoice(container, role) ? "Other" : undefined;
}

function buildChoiceOptions(nodes: HTMLElement[], container: HTMLElement, role: "radio" | "checkbox"): {
  options: string[];
  otherOption?: string;
} {
  const options = extractOptionsFromRoleNodes(nodes);
  const otherOption = detectOtherOptionLabel(options, container, role);

  if (otherOption && !options.some((option) => optionEquals(option, otherOption))) {
    options.push(otherOption);
  }

  return { options, otherOption };
}

function isChoiceWithOtherValue(value: FieldValue): value is ChoiceWithOtherValue {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "choice_with_other";
}

function detectField(container: HTMLElement, index: number): FieldDescriptor | null {
  const label = getQuestionLabel(container);
  if (!label) {
    return null;
  }

  const radioOptions = Array.from(container.querySelectorAll<HTMLElement>('[role="radio"]')).filter(isVisible);
  if (radioOptions.length) {
    const { options, otherOption } = buildChoiceOptions(radioOptions, container, "radio");
    const numericScale = !otherOption && radioOptions.every((option) => {
      const labelText = getChoiceLabel(option);
      return !labelText || /^\d+$/.test(labelText);
    });
    return {
      field: {
        id: uniqueFieldId(container, label, index),
        label,
        normalizedLabel: normalizeText(label),
        type: numericScale ? "scale" : "radio",
        required: isRequired(container, label),
        options,
        otherOption,
        helpText: getHelpText(container),
        sectionTitle: getSectionTitle(container),
      },
      container,
      control: radioOptions[0],
      type: numericScale ? "scale" : "radio",
    };
  }

  const checkboxOptions = Array.from(container.querySelectorAll<HTMLElement>('[role="checkbox"]')).filter(isVisible);
  if (checkboxOptions.length) {
    const { options, otherOption } = isVerifiedEmailConsentContainer(container)
      ? { options: [getVerifiedEmailOptionLabel(container)], otherOption: undefined }
      : buildChoiceOptions(checkboxOptions, container, "checkbox");
    return {
      field: {
        id: uniqueFieldId(container, label, index),
        label,
        normalizedLabel: normalizeText(label),
        type: "checkbox",
        required: isRequired(container, label),
        options,
        otherOption,
        helpText: getHelpText(container),
        sectionTitle: getSectionTitle(container),
      },
      container,
      control: checkboxOptions[0],
      type: "checkbox",
    };
  }

  const select = container.querySelector<HTMLSelectElement>("select");
  if (select && isVisible(select)) {
    return {
      field: {
        id: uniqueFieldId(container, label, index),
        label,
        normalizedLabel: normalizeText(label),
        type: "dropdown",
        required: isRequired(container, label),
        options: Array.from(select.options)
          .filter((option) => isSelectableNativeOption(option, select.options.length))
          .map((option) => option.textContent?.trim() ?? "")
          .filter(Boolean),
        helpText: getHelpText(container),
        sectionTitle: getSectionTitle(container),
      },
      container,
      control: select,
      type: "dropdown",
    };
  }

  const textInput = container.querySelector<HTMLInputElement>('input[type="text"], input[type="email"], input[type="number"], input[type="tel"], input[type="url"]');
  if (textInput && isVisible(textInput)) {
    return {
      field: {
        id: uniqueFieldId(container, label, index),
        label,
        normalizedLabel: normalizeText(label),
        type: "text",
        required: isRequired(container, label),
        helpText: getHelpText(container),
        sectionTitle: getSectionTitle(container),
      },
      container,
      control: textInput,
      type: "text",
    };
  }

  const dateInput = container.querySelector<HTMLInputElement>('input[type="date"]');
  if (dateInput && isVisible(dateInput)) {
    return {
      field: {
        id: uniqueFieldId(container, label, index),
        label,
        normalizedLabel: normalizeText(label),
        type: "date",
        required: isRequired(container, label),
        helpText: getHelpText(container),
        sectionTitle: getSectionTitle(container),
      },
      container,
      control: dateInput,
      type: "date",
    };
  }

  const timeInput = container.querySelector<HTMLInputElement>('input[type="time"]');
  if (timeInput && isVisible(timeInput)) {
    return {
      field: {
        id: uniqueFieldId(container, label, index),
        label,
        normalizedLabel: normalizeText(label),
        type: "time",
        required: isRequired(container, label),
        helpText: getHelpText(container),
        sectionTitle: getSectionTitle(container),
      },
      container,
      control: timeInput,
      type: "time",
    };
  }

  const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
  if (textarea && isVisible(textarea)) {
    return {
      field: {
        id: uniqueFieldId(container, label, index),
        label,
        normalizedLabel: normalizeText(label),
        type: "textarea",
        required: isRequired(container, label),
        helpText: getHelpText(container),
        sectionTitle: getSectionTitle(container),
      },
      container,
      control: textarea,
      type: "textarea",
    };
  }

  const listbox = container.querySelector<HTMLElement>('[role="listbox"]');
  if (listbox && isVisible(listbox)) {
    const options = getListboxOptionNodes(listbox, container)
      .map((option) => rawTextContent(option))
      .filter(Boolean);

    return {
      field: {
        id: uniqueFieldId(container, label, index),
        label,
        normalizedLabel: normalizeText(label),
        type: "dropdown",
        required: isRequired(container, label),
        options,
        helpText: getHelpText(container),
        sectionTitle: getSectionTitle(container),
      },
      container,
      control: listbox,
      type: "dropdown",
    };
  }

  return null;
}

export function scanFormDocument(root: Document, url = root.location.href): ScanResult {
  const descriptors = getQuestionContainers(root).map(detectField).filter((value): value is FieldDescriptor => Boolean(value));
  const fields = descriptors.map((descriptor) => descriptor.field);
  const title = rawTextContent(root.querySelector("title")) || rawTextContent(root.querySelector("h1")) || "Untitled Google Form";

  return {
    title,
    url,
    formKey: createFormKey(url, title, fields.map((field) => field.label)),
    fields,
  };
}

function dispatchInputEvents(element: HTMLElement): void {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new Event("blur", { bubbles: true }));
}

function setNativeInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(element, value);
  dispatchInputEvents(element);
}

function fillTextField(control: HTMLElement, value: FieldValue): boolean {
  if (typeof value !== "string" && typeof value !== "number") {
    return false;
  }

  if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
    setNativeInputValue(control, String(value));
    return true;
  }

  return false;
}

function isSelected(node: HTMLElement): boolean {
  return node.getAttribute("aria-checked") === "true" || node.getAttribute("aria-selected") === "true";
}

function toggleRoleOption(node: HTMLElement): void {
  node.click();
}

function selectRadioOption(container: HTMLElement, target: string): HTMLElement | null {
  const options = Array.from(container.querySelectorAll<HTMLElement>('[role="radio"]')).filter(isVisible);
  const match =
    options.find((option) => optionEquals(getChoiceLabel(option), target)) ??
    (optionEquals(target, "Other") ? findAttachedOtherChoice(container, "radio") : null);
  if (!match) {
    return null;
  }

  if (!isSelected(match)) {
    toggleRoleOption(match);
  }

  return match;
}

function fillCheckboxGroup(container: HTMLElement, targetValues: string[]): boolean {
  if (targetValues.length === 0) {
    return false;
  }

  const desired = new Set(targetValues.map((value) => normalizeText(value)));
  const verifiedEmailOption = isVerifiedEmailConsentContainer(container) ? getVerifiedEmailOptionLabel(container) : null;
  const options = Array.from(container.querySelectorAll<HTMLElement>('[role="checkbox"]'))
    .filter(isVisible)
    .map((option) => {
      const choiceLabel = getChoiceLabel(option);
      const labelText = verifiedEmailOption ?? (choiceLabel || (hasAttachedTextControl(option, "checkbox", container) ? "Other" : ""));

      return {
        option,
        label: normalizeText(labelText),
      };
    });

  const availableLabels = new Set(options.map(({ label }) => label).filter(Boolean));
  if (desired.size > 0 && Array.from(desired).some((label) => !availableLabels.has(label))) {
    return false;
  }

  for (const { option, label } of options) {
    if (!label) {
      continue;
    }

    const shouldBeChecked = desired.has(label);
    const currentlyChecked = isSelected(option);
    if (shouldBeChecked !== currentlyChecked) {
      toggleRoleOption(option);
    }
  }

  return availableLabels.size > 0 || targetValues.length === 0;
}

function fillChoiceAttachedText(
  choiceNode: HTMLElement | null,
  role: "radio" | "checkbox",
  container: HTMLElement,
  text: string,
): boolean {
  const control = (choiceNode ? findAttachedTextControl(choiceNode, role, container) : null) ?? findSingleBoundaryTextControl(container);
  if (!control) {
    return false;
  }

  setNativeInputValue(control, text);
  return true;
}

function fillDropdown(container: HTMLElement, control: HTMLElement, value: string): boolean {
  if (control instanceof HTMLSelectElement) {
    const option = Array.from(control.options).find((candidate) =>
      isSelectableNativeOption(candidate, control.options.length) && optionEquals(candidate.textContent ?? "", value),
    );
    if (!option) {
      return false;
    }

    control.value = option.value;
    dispatchInputEvents(control);
    return true;
  }

  if (control.getAttribute("role") === "listbox") {
    control.click();
    const candidates = getListboxOptionNodes(control, container);
    const option = candidates.find((candidate) => optionEquals(rawTextContent(candidate), value));
    if (!option) {
      return false;
    }

    option.click();
    return true;
  }

  return false;
}

function getListboxOptionNodes(control: HTMLElement, container: HTMLElement): HTMLElement[] {
  const popupId = control.getAttribute("aria-controls") ?? control.getAttribute("aria-owns");
  const popupRoot = popupId ? document.getElementById(popupId) : null;
  return Array.from((popupRoot ?? container).querySelectorAll<HTMLElement>('[role="option"]')).filter(isVisible);
}

function findDescriptorByField(root: Document, field: DetectedField): FieldDescriptor | null {
  const descriptors = getQuestionContainers(root).map(detectField).filter((value): value is FieldDescriptor => Boolean(value));

  return (
    descriptors.find((descriptor) => descriptor.field.id === field.id) ??
    descriptors.find((descriptor) => descriptor.field.normalizedLabel === field.normalizedLabel) ??
    null
  );
}

export function fillFormDocument(root: Document, request: FillRequest): FillResult {
  const filledFieldIds: string[] = [];
  const skippedFieldIds: string[] = [];

  for (const [fieldId, value] of Object.entries(request.values)) {
    const referenceField =
      request.fields?.find((field) => field.id === fieldId) ??
      request.fields?.find((field) => field.normalizedLabel === normalizeText(fieldId));

    if (!referenceField) {
      skippedFieldIds.push(fieldId);
      continue;
    }

    const descriptor = findDescriptorByField(root, referenceField);
    if (!descriptor || !isVisible(descriptor.container)) {
      skippedFieldIds.push(fieldId);
      continue;
    }

    let success = false;

    switch (descriptor.type) {
      case "text":
      case "textarea":
      case "date":
      case "time":
        success = fillTextField(descriptor.control, value);
        break;
      case "radio":
      case "scale":
        if (typeof value === "string" || typeof value === "number") {
          success = Boolean(selectRadioOption(descriptor.container, String(value)));
        } else if (isChoiceWithOtherValue(value) && typeof value.selected === "string") {
          if (referenceField.otherOption && optionEquals(referenceField.otherOption, value.selected) && !value.otherText.trim()) {
            success = false;
            break;
          }

          const selected = String(value.selected);
          const match = selectRadioOption(descriptor.container, selected);
          success = Boolean(match);

          if (success && referenceField.otherOption && optionEquals(referenceField.otherOption, selected)) {
            success = fillChoiceAttachedText(match, "radio", descriptor.container, value.otherText);
          }
        } else {
          success = false;
        }
        break;
      case "checkbox":
        if (Array.isArray(value)) {
          success = fillCheckboxGroup(descriptor.container, value.map(String));
        } else if (isChoiceWithOtherValue(value) && Array.isArray(value.selected)) {
          const normalizedSelected = referenceField.otherOption && !value.otherText.trim()
            ? value.selected.filter((item) => !optionEquals(item, referenceField.otherOption as string))
            : value.selected;

          if (
            referenceField.otherOption &&
            normalizedSelected.length === value.selected.length &&
            value.selected.some((item) => optionEquals(item, referenceField.otherOption as string)) &&
            !value.otherText.trim()
          ) {
            success = false;
            break;
          }

          success = fillCheckboxGroup(descriptor.container, normalizedSelected.map(String));
          if (
            success &&
            referenceField.otherOption &&
            normalizedSelected.some((item) => optionEquals(item, referenceField.otherOption as string))
          ) {
            success = fillChoiceAttachedText(findAttachedOtherChoice(descriptor.container, "checkbox"), "checkbox", descriptor.container, value.otherText);
          }
        } else {
          success = false;
        }
        break;
      case "dropdown":
        success = typeof value === "string" || typeof value === "number" ? fillDropdown(descriptor.container, descriptor.control, String(value)) : false;
        break;
      default:
        success = false;
        break;
    }

    if (success) {
      filledFieldIds.push(fieldId);
    } else {
      skippedFieldIds.push(fieldId);
    }
  }

  return { filledFieldIds, skippedFieldIds };
}

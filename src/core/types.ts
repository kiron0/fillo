export type FieldType =
  | "text"
  | "textarea"
  | "radio"
  | "checkbox"
  | "dropdown"
  | "scale"
  | "date"
  | "time"
  | "grid";

export interface ChoiceWithOtherValue {
  kind: "choice_with_other";
  selected: string | string[];
  otherText: string;
}

export type FieldValue = string | string[] | number | boolean | null | ChoiceWithOtherValue;

export type ProfileValue = string | string[] | boolean | number;

export type MessageResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

export interface DetectedField {
  id: string;
  label: string;
  normalizedLabel: string;
  type: FieldType;
  required: boolean;
  options?: string[];
  otherOption?: string;
  sectionTitle?: string;
  helpText?: string;
}

export interface Profile {
  id: string;
  name: string;
  values: Record<string, ProfileValue>;
  createdAt: number;
  updatedAt: number;
}

export interface FormPreset {
  id: string;
  formKey: string;
  name: string;
  formTitle?: string;
  formUrl?: string;
  fields: DetectedField[];
  values: Record<string, FieldValue>;
  mappings?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  defaultProfileId: string | null;
  autoLoadMatchingProfile: boolean;
  confirmBeforeFill: boolean;
  showBackupSection: boolean;
}

export interface ExportedAppData {
  version: 1;
  exportedAt: number;
  profiles: Profile[];
  presets: FormPreset[];
  settings: AppSettings;
}

export interface ImportedAppData {
  profiles?: Profile[];
  presets?: FormPreset[];
  settings?: AppSettings;
}

export interface ActiveFormContext {
  title: string;
  url: string;
  formKey: string;
  fields: DetectedField[];
}

export interface ActiveFormLookup {
  status: "ready" | "invalid_url" | "no_active_tab";
  pageUrl?: string;
  context?: ActiveFormContext;
}

export interface FillResult {
  filledFieldIds: string[];
  skippedFieldIds: string[];
}

export interface ScanResult extends ActiveFormContext {}

export interface FillRequest {
  formKey: string;
  values: Record<string, FieldValue>;
  fields?: DetectedField[];
}

export type BackgroundRequest =
  | { type: "GET_ACTIVE_FORM_CONTEXT" }
  | { type: "FILL_ACTIVE_FORM"; payload: FillRequest };

export type ContentRequest =
  | { type: "PING" }
  | { type: "SCAN_FORM" }
  | { type: "FILL_FORM"; payload: FillRequest };

export const DEFAULT_SETTINGS: AppSettings = {
  defaultProfileId: null,
  autoLoadMatchingProfile: true,
  confirmBeforeFill: true,
  showBackupSection: false,
};

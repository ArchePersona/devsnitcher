export interface EnvironmentInfo {
  url: string;
  title: string;
  browser: string;
  platform: string;
  viewport: { width: number; height: number };
  timestamp: number;
}

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface ConsoleEntry {
  level: ConsoleLevel;
  message: string;
  timestamp: number;
  stack?: string;
}

export interface NetworkEntry {
  url: string;
  method: string;
  status: number;
  duration: number;
  responsePreview: string;
  requestHeaders: Record<string, string>;
}

export type JsErrorType = 'unhandled_exception' | 'promise_rejection';

export interface JsErrorEntry {
  type: JsErrorType;
  message: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  stack: string;
}

export interface DomContext {
  selector: string;
  html: string;
  className: string;
  tagName: string;
  isFocused: boolean;
}

export interface ScreenshotInfo {
  dataUrl: string;
  width: number;
  height: number;
}

export interface Evidence {
  environment: EnvironmentInfo;
  console: ConsoleEntry[];
  network: NetworkEntry[];
  jsErrors: JsErrorEntry[];
  dom: DomContext | null;
  screenshot: ScreenshotInfo | null;
}

export interface ReportInput {
  evidence: Evidence;
  userNotes: string;
}

export type ReportFormat = 'markdown' | 'json';

/** High-level, background-owned interaction state surfaced to the popup. */
export type SnitchUiState = 'idle' | 'observing' | 'snitchshot_pending';

export type SnitchMessage =
  | { type: 'EVIDENCE_ERROR'; error: string }
  | { type: 'SNITCH'; userNotes: string; screenshot: boolean }
  | { type: 'SNITCH_ACCEPTED'; tabId: number; windowId?: number }
  | { type: 'SNITCH_ERROR'; error: string }
  | { type: 'GET_STATUS' }
  | { type: 'STATUS_RESULT'; state: SnitchUiState; error?: string }
  | { type: 'CANCEL_SNITCH' }
  | { type: 'CANCEL_ACCEPTED' }
  | { type: 'GET_SNITCHSHOT' }
  | { type: 'SNITCHSHOT_CONTENT'; report: string }
  | { type: 'CLIPBOARD_RELEASED' }
  | { type: 'CLIPBOARD_CLEARED' };

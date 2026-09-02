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

export type SnitchMessage =
  | { type: 'EVIDENCE_ERROR'; error: string }
  | { type: 'CACHE_EVIDENCE'; evidence: Evidence }
  | { type: 'CACHE_STORED' }
  | { type: 'REFRESH_CACHE' }
  | { type: 'CACHE_REFRESHED' }
  | { type: 'GET_TAB_ID' }
  | { type: 'TAB_ID'; tabId: number }
  | { type: 'GET_BOUNDED_OBSERVATION' }
  | {
      type: 'BOUNDED_OBSERVATION';
      environment: EnvironmentInfo;
      dom: DomContext | null;
    }
  | { type: 'PING' }
  | { type: 'PONG' }
  | { type: 'SNITCH'; userNotes: string; screenshot: boolean }
  | { type: 'SNITCH_RESULT'; report: string; screenshotDataUrl?: string }
  | { type: 'SNITCH_ERROR'; error: string }
  | { type: 'SNITCHSHOT_STATUS' }
  | { type: 'SNITCHSHOT_STATUS_RESULT'; occupied: boolean }
  | { type: 'PASTE_SNITCHSHOT' }
  | { type: 'PASTE_SNITCHSHOT_RESULT'; pasted: boolean; error?: string };

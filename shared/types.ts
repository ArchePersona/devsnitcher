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
  | { type: 'COLLECT_EVIDENCE' }
  | { type: 'EVIDENCE_RESULT'; evidence: Evidence }
  | { type: 'EVIDENCE_ERROR'; error: string }
  | { type: 'PING' }
  | { type: 'PONG' }
  | { type: 'SNITCH'; userNotes: string; screenshot: boolean }
  | { type: 'SNITCH_RESULT'; report: string; screenshotDataUrl?: string }
  | { type: 'SNITCH_ERROR'; error: string };

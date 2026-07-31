import type { EnvironmentInfo } from '../shared/types';

export function collectEnvironment(): EnvironmentInfo {
  const nav = navigator.userAgent;
  return {
    url: location.href,
    title: document.title,
    browser: parseBrowser(nav),
    platform: navigator.platform,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    timestamp: Date.now(),
  };
}

function parseBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return 'Microsoft Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return ua;
}

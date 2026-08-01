const { spawn, execSync } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');

const CHROMIUM_PATH = 'C:\\Users\\thero\\.cache\\puppeteer\\chrome\\win64-151.0.7922.47\\chrome-win64\\chrome.exe';
const EXTENSION_PATH = 'D:\\DEVSnitcher\\dist';
const TEST_URL = 'http://localhost:8088/test.html';
const USER_DATA = 'D:\\DEVSnitcher-chromium-data';
const PORT = 9222;

function httpRequest(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const options = { hostname: '127.0.0.1', port: PORT, path, method };
    const req = http.request(options, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

function waitForPort(port, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
        if (res.statusCode === 200) {
          let b = '';
          res.on('data', () => {});
          res.on('end', () => resolve());
        } else {
          if (Date.now() - start > timeout) reject(new Error('Port timeout'));
          else setTimeout(check, 500);
        }
      });
      req.on('error', () => {
        if (Date.now() - start > timeout) reject(new Error('Port timeout'));
        else setTimeout(check, 500);
      });
    };
    check();
  });
}

async function main() {
  // Check if http-server is running
  try {
    await new Promise((resolve, reject) => {
      http.get('http://localhost:8088/test.html', (res) => {
        let b = '';
        res.on('data', () => {});
        res.on('end', resolve);
      }).on('error', reject);
    });
    console.log('http-server is running on port 8088');
  } catch (e) {
    console.error('http-server is NOT running on port 8088');
    console.error('Please start it with: http-server D:\\DEVSnitcher -p 8088');
    process.exit(1);
  }

  // Clean up old user data
  if (fs.existsSync(USER_DATA)) {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
  }

  // Launch Chromium
  console.log('1. Launching Chromium...');
  const args = [
    `--load-extension=${EXTENSION_PATH}`,
    `--user-data-dir=${USER_DATA}`,
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-extensions-except=' + EXTENSION_PATH,
    '--remote-debugging-port=' + PORT,
  ];

  const chrome = spawn(CHROMIUM_PATH, args, { stdio: 'ignore' });
  console.log('   PID:', chrome.pid);

  // Wait for browser to be ready
  console.log('   Waiting for browser...');
  await waitForPort(PORT, 20000);
  console.log('   Browser ready');

  // Wait for extension to load
  await new Promise((r) => setTimeout(r, 3000));

  // Connect via CDP
  const browserWsUrl = (await httpRequest('/json/version')).webSocketDebuggerUrl;
  console.log('   Browser WS:', browserWsUrl);

  const ws = new WebSocket(browserWsUrl);
  const pending = new Map();
  let nextId = 1;

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id !== undefined) {
      const cb = pending.get(msg.id);
      if (cb) {
        pending.delete(msg.id);
        clearTimeout(cb.timer);
        if (msg.error) cb.reject(msg.error);
        else cb.resolve(msg.result || {});
      }
    }
  });

  ws.on('error', (e) => console.error('Browser WS error:', e.message));

  function cdp(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 10000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.on('error', reject); });
  console.log('   Connected to browser');

  // Create new tab
  console.log('\n2. Creating new tab with test page...');
  const newTab = await cdp('Target.createTarget', { url: TEST_URL });
  const targetId = newTab.targetId;
  const targetInfo = await cdp('Target.getTargetInfo', { targetId });
  console.log('   Target created:', targetInfo.targetInfo?.title || 'no title');

  // Attach to the target
  const sessionRes = await cdp('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  const sessionId = sessionRes.sessionId;
  console.log('   Attached to target (session:', sessionId, ')');

  // Create a session-specific CDP client
  const sessionWs = ws; // Same WebSocket, but use sessionId in params

  function sessionCdp(method, params = {}, sid = sessionId) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
      pending.set(id, { resolve, reject, timer });
      const msg = { id, method, params };
      if (sid) msg.sessionId = sid;
      sessionWs.send(JSON.stringify(msg));
    });
  }

  // Wait for page to load
  await sessionCdp('Page.enable');
  await sessionCdp('Runtime.enable');
  await new Promise((r) => setTimeout(r, 3000));

  const urlRes = await sessionCdp('Runtime.evaluate', {
    expression: 'location.href',
    returnByValue: true
  });
  console.log('   URL:', urlRes?.result?.value);

  // Wait for content script and page script to fully load and initialize
  console.log('\n   Waiting for content script initialization...');
  await new Promise((r) => setTimeout(r, 3000));

  // Verify page script is running by checking if console.error is wrapped
  const consoleWrapped = await sessionCdp('Runtime.evaluate', {
    expression: 'Object.getOwnPropertyDescriptor(window.console, "error").value.toString().includes("pushEntry")',
    returnByValue: true
  });
  console.log('   Console.error wrapped:', consoleWrapped?.result?.value);

  // Trigger error buttons
  console.log('\n3. Triggering error buttons...');
  for (const id of ['console-error', 'fetch-404', 'js-error', 'promise-rejection']) {
    await sessionCdp('Runtime.evaluate', {
      expression: `document.getElementById('${id}')?.click(); true`,
      returnByValue: true
    });
    console.log('   Clicked:', id);
    await new Promise((r) => setTimeout(r, 500));
  }

  // Send SNITCH
  console.log('\n4. Sending SNITCH...');
  const snitchRes = await sessionCdp('Runtime.evaluate', {
    expression: `new Promise((resolve) => {
      const handler = (ev) => {
        const d = ev.data;
        if (!d || typeof d !== 'object') return;
        if (d.type === 'SNITCH_RESULT' || d.type === 'SNITCH_ERROR') {
          window.removeEventListener('message', handler);
          resolve(d);
        }
      };
      window.addEventListener('message', handler);
      window.postMessage({ type: 'SNITCH', userNotes: 'Browser test.', screenshot: false }, '*');
      setTimeout(() => { window.removeEventListener('message', handler); resolve({ type: 'TIMEOUT' }); }, 15000);
    })`,
    awaitPromise: true,
    returnByValue: true
  });

  const resp = snitchRes?.result?.value;
  console.log('   Response:', resp?.type);

  if (resp?.type === 'SNITCH_RESULT') {
    console.log('\n5. Report:');
    console.log(resp.report);
    console.log('\n--- CHECKLIST ---');
    const checks = [
      ['URL', resp.report.includes('localhost:8088')],
      ['Console error', resp.report.includes('console error')],
      ['404', resp.report.includes('404')],
      ['Unhandled exc', resp.report.includes('unhandled')],
      ['Promise reject', resp.report.includes('promise_rejection')],
      ['DOM context', resp.report.includes('DOM Context')],
      ['Report header', resp.report.includes('# DEVSNITCHER REPORT')],
      ['Redacted', resp.report.includes('[REDACTED]')],
      ['No raw token', !resp.report.includes('Bearer abc123')],
    ];
    let pass = 0, fail = 0;
    checks.forEach(([l, ok]) => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${l}`); if (ok) pass++; else fail++; });
    console.log(`\n${pass}/${checks.length} passed`);
  } else {
    console.log('   Response:', JSON.stringify(resp).slice(0, 500));
  }

  // Cleanup
  ws.close();
  chrome.kill();
  console.log('\nBrowser closed');
}

main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });

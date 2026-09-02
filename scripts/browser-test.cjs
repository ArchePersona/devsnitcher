const WebSocket = require('ws');
const http = require('http');

function httpRequest(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const options = { hostname: '127.0.0.1', port: 9222, path, method };
    const req = http.request(options, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  await new Promise((r) => setTimeout(r, 2000));

  console.log('1. Creating new tab and navigating to test page...');
  const newTab = await httpRequest('/json/new', 'PUT');
  const wsUrl = newTab.webSocketDebuggerUrl;

  const pending = new Map();
  let nextId = 1;

  const ws = new WebSocket(wsUrl);

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

  ws.on('error', (e) => console.error('WS error:', e.message));

  function cdp(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out after 15s`));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.on('error', reject);
  });
  console.log('   Connected to CDP');

  await cdp('Page.enable');
  await cdp('Runtime.enable');

  // Navigate to test page
  console.log('   Navigating to test page...');
  await cdp('Page.navigate', { url: 'http://localhost:8088/test.html' });

  // Wait for page to load
  console.log('   Waiting for page load...');
  await new Promise((resolve) => {
    const onMsg = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.method === 'Page.loadEventFired') {
        ws.removeListener('message', onMsg);
        resolve();
      }
    };
    ws.on('message', onMsg);
    setTimeout(() => { ws.removeListener('message', onMsg); resolve(); }, 10000);
  });

  // Verify URL
  const urlRes = await cdp('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
  console.log('   URL:', urlRes?.result?.value);

  // Check content script injection
  console.log('\n2. Checking content script injection...');
  const scriptsRes = await cdp('Runtime.evaluate', {
    expression: 'Array.from(document.querySelectorAll("script")).map(s => s.src || "inline")',
    returnByValue: true
  });
  const scripts = scriptsRes?.result?.value || [];
  console.log('   Scripts:', scripts);
  const hasPageScript = scripts.some((s) => typeof s === 'string' && s.includes('page-script'));
  console.log('   Page script injected:', hasPageScript);

  if (hasPageScript) {
    console.error('   FAIL: page-script.js should not be injected after DEVPEEPER-005');
    ws.close();
    process.exit(1);
  }

  // Trigger error buttons
  console.log('\n3. Triggering error buttons...');
  const buttons = ['console-error', 'fetch-404', 'js-error', 'promise-rejection'];
  for (const btn of buttons) {
    await cdp('Runtime.evaluate', {
      expression: `document.getElementById("${btn}")?.click(); true`,
      returnByValue: true
    });
    console.log(`   Clicked: ${btn}`);
    await new Promise((r) => setTimeout(r, 500));
  }

  // Send SNITCH via postMessage and wait for response
  console.log('\n4. Sending SNITCH via window.postMessage...');
  const snitchRes = await cdp('Runtime.evaluate', {
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
      window.postMessage({ type: 'SNITCH', userNotes: 'Browser test: triggered error buttons, console error, failed fetch, and JS exceptions.', screenshot: false }, '*');
      setTimeout(() => { window.removeEventListener('message', handler); resolve({ type: 'TIMEOUT' }); }, 15000);
    })`,
    awaitPromise: true,
    returnByValue: true
  });

  const resp = snitchRes?.result?.value;
  console.log('   Response type:', resp?.type);

  if (resp?.type === 'SNITCH_RESULT') {
    console.log('\n5. Report received! Length:', resp.report.length);
    console.log('\n--- REPORT (first 5000 chars) ---');
    console.log(resp.report.slice(0, 5000));
    console.log('--- END REPORT ---');

    const checks = [
      ['URL captured', resp.report.includes('localhost:8088')],
      ['Console error', resp.report.includes('console error')],
      ['Failed fetch (404)', resp.report.includes('404')],
      ['Unhandled exception', resp.report.includes('unhandled')],
      ['Promise rejection', resp.report.includes('promise_rejection') || resp.report.includes('Promise')],
      ['DOM context', resp.report.includes('DOM Context')],
      ['Report format', resp.report.includes('# DEVSNITCHER REPORT')],
      ['No raw Bearer tokens', !resp.report.includes('Bearer abc123')],
      ['Redacted markers', resp.report.includes('[REDACTED]')],
      ['User description', resp.report.includes('Browser test')],
    ];

    console.log('\n--- CHECKLIST ---');
    let pass = 0, fail = 0;
    checks.forEach(([label, ok]) => {
      console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
      if (ok) pass++; else fail++;
    });
    console.log(`\n${pass}/${checks.length} checks passed, ${fail} failed`);
  } else if (resp?.type === 'SNITCH_ERROR') {
    console.error('   Error:', resp.error);
  } else {
    console.log('   Response:', JSON.stringify(resp).slice(0, 500));
  }

  ws.close();
}

main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });

/**
 * Arcwork Browser Bridge (MV3 service worker).
 * Connects OUT to the user's Arcwork server with a device token and executes browser
 * commands queued by their agents, in a single dedicated "Arcwork" tab.
 */

const DEFAULTS = { server: 'https://arcwork-ai.vercel.app', token: null, askBeforeActions: true };
let polling = false;
const pendingApprovals = new Map();

async function settings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(['server', 'token', 'askBeforeActions', 'deviceName'])) };
}

async function log(line) {
  const { activity = [] } = await chrome.storage.local.get('activity');
  activity.push(`${new Date().toLocaleTimeString()}  ${line}`);
  await chrome.storage.local.set({ activity: activity.slice(-60) });
}

async function setStatus(status) {
  await chrome.storage.local.set({ status });
  chrome.action.setBadgeText({ text: status === 'connected' ? '' : status === 'not paired' ? '' : '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
}

// ---------------------------------------------------------------- agent tab

async function agentTab(createUrl) {
  const { agentTabId } = await chrome.storage.session.get('agentTabId');
  if (agentTabId) {
    try {
      const tab = await chrome.tabs.get(agentTabId);
      if (createUrl) await chrome.tabs.update(tab.id, { url: createUrl, active: true });
      return await chrome.tabs.get(tab.id);
    } catch {
      // tab was closed
    }
  }
  const tab = await chrome.tabs.create({ url: createUrl || 'about:blank', active: true });
  try {
    const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
    await chrome.tabGroups.update(groupId, { title: 'Arcwork agent', color: 'orange' });
  } catch {
    // grouping is cosmetic
  }
  await chrome.storage.session.set({ agentTabId: tab.id });
  return tab;
}

function waitForLoad(tabId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => t.status === 'complete' && done()).catch(done);
  });
}

async function inPage(tabId, func, args = []) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res?.result;
}

// Runs in the page. Numbers visible interactive elements and returns text + element list.
function pageSnapshot(maxChars) {
  const sel = 'a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[contenteditable=true],summary';
  const els = Array.from(document.querySelectorAll(sel)).filter((el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  });
  document.querySelectorAll('[data-shazam-idx]').forEach((el) => el.removeAttribute('data-shazam-idx'));
  const items = els.slice(0, 300).map((el, i) => {
    el.setAttribute('data-shazam-idx', String(i));
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type') || '';
    const label = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const kind = tag === 'a' ? 'link' : tag === 'input' ? `input${type ? `:${type}` : ''}` : tag;
    return `[${i}] ${kind} "${label}"${tag === 'a' ? ` → ${el.getAttribute('href')?.slice(0, 80)}` : ''}`;
  });
  const text = (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, maxChars);
  return { title: document.title, url: location.href, text, elements: items.join('\n') };
}

function pageClick(idx) {
  const el = document.querySelector(`[data-shazam-idx="${idx}"]`);
  if (!el) return { ok: false, error: 'Element not found. Call browser_read again; the page changed.' };
  el.scrollIntoView({ block: 'center' });
  el.click();
  return { ok: true, label: (el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 80) };
}

function pageType(idx, text, submit) {
  const el = document.querySelector(`[data-shazam-idx="${idx}"]`);
  if (!el) return { ok: false, error: 'Element not found. Call browser_read again.' };
  const type = (el.getAttribute('type') || '').toLowerCase();
  const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
  const name = `${el.getAttribute('name') || ''} ${el.id || ''}`.toLowerCase();
  if (type === 'password' || /cc-|card|cvc|cvv|iban/.test(`${ac} ${name}`)) {
    return { ok: false, error: 'Refused: Arcwork never types into password or payment fields. Ask the user to do this step.' };
  }
  el.focus();
  if (el.isContentEditable) {
    document.execCommand('insertText', false, text);
  } else {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (submit) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    if (el.form) el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit();
  }
  return { ok: true };
}

// ---------------------------------------------------------------- approvals

function askApproval(title, message) {
  return new Promise((resolve) => {
    const id = `shazam-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pendingApprovals.set(id, resolve);
    chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: 'icon128.png',
      title,
      message: message.slice(0, 250),
      buttons: [{ title: 'Allow' }, { title: 'Deny' }],
      requireInteraction: true,
      priority: 2,
    });
    setTimeout(() => {
      if (pendingApprovals.has(id)) {
        pendingApprovals.delete(id);
        chrome.notifications.clear(id);
        resolve(false);
      }
    }, 120000);
  });
}

chrome.notifications.onButtonClicked.addListener((id, buttonIndex) => {
  const resolve = pendingApprovals.get(id);
  if (resolve) {
    pendingApprovals.delete(id);
    resolve(buttonIndex === 0);
  }
  chrome.notifications.clear(id);
});
chrome.notifications.onClosed.addListener((id) => {
  const resolve = pendingApprovals.get(id);
  if (resolve) {
    pendingApprovals.delete(id);
    resolve(false);
  }
});

// ---------------------------------------------------------------- commands

async function handle(cmd) {
  const p = cmd.payload || {};
  const s = await settings();
  switch (cmd.command) {
    case 'open': {
      const url = new URL(p.url);
      if (!/^https?:$/.test(url.protocol)) return { ok: false, result: 'Only http(s) URLs can be opened.' };
      const tab = await agentTab(url.toString());
      await waitForLoad(tab.id);
      const t = await chrome.tabs.get(tab.id);
      await log(`opened ${t.url}`);
      return { ok: true, result: `Opened "${t.title}" (${t.url}). Call browser_read to see the page.` };
    }
    case 'read': {
      const tab = await agentTab();
      const snap = await inPage(tab.id, pageSnapshot, [Number(p.maxChars) || 15000]);
      if (!snap) return { ok: false, result: 'Could not read this page (browser pages like chrome:// are off-limits).' };
      return { ok: true, result: `Title: ${snap.title}\nURL: ${snap.url}\n\nInteractive elements:\n${snap.elements || '(none)'}\n\nPage text:\n${snap.text}` };
    }
    case 'click': {
      const tab = await agentTab();
      if (s.askBeforeActions && !(await askApproval('Arcwork wants to click', `${p.reason || 'Click element'} [${p.element}] on ${new URL(tab.url || 'about:blank').host}`))) {
        await log(`denied click [${p.element}]`);
        return { ok: false, result: 'The user denied this click.' };
      }
      const r = await inPage(tab.id, pageClick, [Number(p.element)]);
      await new Promise((res) => setTimeout(res, 800));
      await waitForLoad(tab.id, 10000);
      await log(`clicked [${p.element}] ${r?.label || ''}`);
      return r?.ok ? { ok: true, result: `Clicked "${r.label}". Call browser_read to see the result.` } : { ok: false, result: r?.error || 'Click failed.' };
    }
    case 'type': {
      const tab = await agentTab();
      if (s.askBeforeActions && !(await askApproval('Arcwork wants to type', `${p.reason || 'Type'}: "${String(p.text).slice(0, 120)}"${p.submit ? ' and submit' : ''}`))) {
        await log(`denied typing into [${p.element}]`);
        return { ok: false, result: 'The user denied typing.' };
      }
      const r = await inPage(tab.id, pageType, [Number(p.element), String(p.text), Boolean(p.submit)]);
      if (p.submit) await waitForLoad(tab.id, 10000);
      await log(`typed into [${p.element}]`);
      return r?.ok ? { ok: true, result: 'Typed.' } : { ok: false, result: r?.error || 'Typing failed.' };
    }
    case 'scroll': {
      const tab = await agentTab();
      await inPage(tab.id, (dir) => window.scrollBy({ top: dir === 'up' ? -window.innerHeight * 0.8 : window.innerHeight * 0.8 }), [p.direction]);
      return { ok: true, result: `Scrolled ${p.direction}.` };
    }
    case 'back': {
      const tab = await agentTab();
      await chrome.tabs.goBack(tab.id).catch(() => {});
      await waitForLoad(tab.id, 10000);
      return { ok: true, result: 'Went back.' };
    }
    case 'screenshot': {
      const tab = await agentTab();
      await chrome.tabs.update(tab.id, { active: true });
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 55 });
      return { ok: true, result: { note: 'Screenshot captured', bytes: Math.round((dataUrl.length * 3) / 4), dataUrl } };
    }
    default:
      return { ok: false, result: `Unknown browser command "${cmd.command}".` };
  }
}

async function api(path, body, signal) {
  const s = await settings();
  const res = await fetch(`${s.server}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` },
    body: JSON.stringify(body),
    signal,
  });
  if (res.status === 401) {
    await chrome.storage.local.remove('token');
    await setStatus('not paired');
    throw Object.assign(new Error('Device token revoked'), { fatal: true });
  }
  return res.json();
}

async function pollLoop() {
  if (polling) return;
  polling = true;
  try {
    while (true) {
      const s = await settings();
      if (!s.token) {
        await setStatus('not paired');
        break;
      }
      try {
        const data = await api('/api/v1/bridge/poll', { waitMs: 20000, capabilities: { browser: navigator.userAgent, version: '1.0.0' } });
        await setStatus('connected');
        for (const cmd of data.commands || []) {
          let out;
          try {
            out = await handle(cmd);
          } catch (err) {
            out = { ok: false, result: String(err.message || err) };
          }
          await api('/api/v1/bridge/result', { id: cmd.id, ok: out.ok, result: out.result }).catch(() => {});
        }
      } catch (err) {
        if (err.fatal) break;
        await setStatus('reconnecting');
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  } finally {
    polling = false;
  }
}

// Service workers sleep; an alarm every 30s restarts the loop if it died.
chrome.alarms.create('shazam-keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => a.name === 'shazam-keepalive' && pollLoop());
chrome.runtime.onStartup.addListener(pollLoop);
chrome.runtime.onInstalled.addListener(pollLoop);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'pair') {
      const res = await fetch(`${msg.server.replace(/\/$/, '')}/api/v1/bridge/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: msg.code, kind: 'browser', name: msg.name || 'Chrome', capabilities: { version: '1.0.0' } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return sendResponse({ ok: false, error: data.error || `HTTP ${res.status}` });
      await chrome.storage.local.set({ server: msg.server.replace(/\/$/, ''), token: data.token, deviceName: data.device?.name });
      await log('paired with Arcwork');
      pollLoop();
      sendResponse({ ok: true });
    } else if (msg.type === 'unpair') {
      await chrome.storage.local.remove('token');
      await setStatus('not paired');
      sendResponse({ ok: true });
    }
  })();
  return true;
});

pollLoop();

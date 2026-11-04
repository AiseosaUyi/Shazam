/**
 * Arcwork Browser Bridge (MV3 service worker).
 * Connects OUT to the user's Arcwork server with a device token and executes browser
 * commands queued by their agents, in a single dedicated "Arcwork" tab.
 */

const DEFAULTS = { server: 'https://arcwork-ai.vercel.app', token: null, askBeforeActions: true, autoApproveHosts: [] };
let polling = false;
const pendingApprovals = new Map();

async function settings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(['server', 'token', 'askBeforeActions', 'deviceName', 'autoApproveHosts'])) };
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

function pageLabel(idx) {
  const el = document.querySelector(`[data-shazam-idx="${idx}"]`);
  if (!el) return '';
  return (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 80);
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

// ---------------------------------------------------------------- in-page helpers (key, select, wait)

function pageKey(keyName, elementIdx) {
  var el;
  if (elementIdx != null) {
    el = document.querySelector('[data-shazam-idx="' + elementIdx + '"]');
  } else {
    el = document.activeElement;
  }
  if (!el) return { ok: false, error: 'No focusable element. Call browser_read first.' };

  var keyMap = {
    'Enter': { key: 'Enter', code: 'Enter', keyCode: 13 },
    'Tab':   { key: 'Tab',   code: 'Tab',   keyCode: 9 },
    'Escape':{ key: 'Escape',code: 'Escape',keyCode: 27 },
    'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    'ArrowUp':     { key: 'ArrowUp',   code: 'ArrowUp',   keyCode: 38 },
    'ArrowLeft':  { key: 'ArrowLeft',  code: 'ArrowLeft',  keyCode: 37 },
    'ArrowRight': { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    'Backspace': { key: 'Backspace', code: 'Backspace', keyCode: 8 },
    'Space':     { key: ' ',        code: 'Space',     keyCode: 32 }
  };
  var km = keyMap[keyName];
  if (!km) return { ok: false, error: 'Unknown key: ' + keyName + '.' };

  el.focus();

  // Tab moves focus to next focusable element
  if (keyName === 'Tab') {
    var sel = 'a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[contenteditable=true]';
    var allEls = Array.from(document.querySelectorAll(sel));
    var idx = allEls.indexOf(el);
    var nextIdx = (idx + 1) % allEls.length;
    allEls[nextIdx].focus();
    return { ok: true };
  }

  // Dispatch keydown, keypress, keyup
  var types = ['keydown', 'keypress', 'keyup'];
  for (var i = 0; i < types.length; i++) {
    el.dispatchEvent(new KeyboardEvent(types[i], Object.assign({ bubbles: true }, km)));
  }

  // Enter on form field triggers submit
  if (keyName === 'Enter' && el.form) {
    el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit();
  }

  return { ok: true };
}

function pageSelect(optionValue, elementIdx) {
  var sel = document.querySelector('[data-shazam-idx="' + elementIdx + '"]');
  if (!sel || sel.tagName.toLowerCase() !== 'select') {
    return { ok: false, error: 'Element is not a <select>. Call browser_read first.' };
  }

  var options = Array.from(sel.options);
  var matched = null;
  for (var i = 0; i < options.length; i++) {
    var opt = options[i];
    if (opt.value.toLowerCase() === optionValue.toLowerCase() ||
        opt.text.trim().toLowerCase() === optionValue.toLowerCase()) {
      matched = opt;
      break;
    }
  }

  if (!matched) {
    return { ok: false, error: 'Not found. Available options: ' +
      options.map(function(o) { return '"' + o.text.trim() + '" (' + o.value + ')'; }).join(', ') };
  }

  sel.value = matched.value;
  sel.dispatchEvent(new Event('input', { bubbles: true }));
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, result: matched.text.trim() };
}

function pageHover(idx) {
  var el = document.querySelector('[data-shazam-idx="' + idx + '"]');
  if (!el) return { ok: false, error: 'No element ' + idx + '. Call browser_read first.' };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  var r = el.getBoundingClientRect();
  var o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window };
  ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove'].forEach(function (t) {
    var C = t.indexOf('pointer') === 0 ? PointerEvent : MouseEvent;
    el.dispatchEvent(new C(t, o));
  });
  return { ok: true, label: (el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 60) };
}

function pageDrag(fromIdx, toIdx) {
  var a = document.querySelector('[data-shazam-idx="' + fromIdx + '"]');
  var b = document.querySelector('[data-shazam-idx="' + toIdx + '"]');
  if (!a || !b) return { ok: false, error: 'Element not found. Call browser_read first.' };
  a.scrollIntoView({ block: 'center' });
  var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
  var pa = { bubbles: true, cancelable: true, clientX: ra.left + ra.width / 2, clientY: ra.top + ra.height / 2, view: window };
  var pb = { bubbles: true, cancelable: true, clientX: rb.left + rb.width / 2, clientY: rb.top + rb.height / 2, view: window };
  var dt = new DataTransfer();
  a.dispatchEvent(new MouseEvent('mousedown', pa));
  a.dispatchEvent(new DragEvent('dragstart', Object.assign({ dataTransfer: dt }, pa)));
  b.dispatchEvent(new DragEvent('dragenter', Object.assign({ dataTransfer: dt }, pb)));
  b.dispatchEvent(new DragEvent('dragover', Object.assign({ dataTransfer: dt }, pb)));
  b.dispatchEvent(new MouseEvent('mousemove', pb));
  b.dispatchEvent(new DragEvent('drop', Object.assign({ dataTransfer: dt }, pb)));
  a.dispatchEvent(new DragEvent('dragend', Object.assign({ dataTransfer: dt }, pb)));
  b.dispatchEvent(new MouseEvent('mouseup', pb));
  return { ok: true };
}

function waitCheck(text, gone) {
  var hasText = document.body && document.body.innerText ? document.body.innerText.includes(text) : false;
  return gone ? !hasText : hasText;
}

async function evalInMain(tabId, code) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [String(code)],
    func: async (src) => {
      try {
        const fn = new Function('return (async () => { ' + src + ' })()');
        const v = await fn();
        let out;
        try { out = JSON.stringify(v === undefined ? null : v); } catch (e) { out = String(v); }
        return { ok: true, value: (out || 'null').slice(0, 5000) };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    },
  });
  return res?.result;
}

// ---------------------------------------------------------------- approvals

function askApprovalNotification(title, message) {
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

// In-page approval bar shown inside the agent tab
function showApprovalBar(title, message, sensitive) {
  return new Promise((resolve) => {
    // Remove any existing bar
    const existing = document.getElementById('arcwork-approval');
    if (existing) existing.remove();

    // Create shadow host
    const host = document.createElement('div');
    host.id = 'arcwork-approval';
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'closed' });

    // Styles
    const style = document.createElement('style');
    style.textContent = `
      :host { position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647; }
      .bar { background: #111; color: #fff; font: 14px system-ui, -apple-system, sans-serif; padding: 10px 14px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
      .msg { flex: 1; min-width: 200px; }
      .msg strong { color: #f59e0b; }
      button { background: #f59e0b; color: #111; border: none; padding: 6px 14px; border-radius: 4px; font: 600 13px system-ui; cursor: pointer; }
      button.secondary { background: #374151; color: #fff; }
      button.danger { background: #ef4444; color: #fff; }
      button:hover { filter: brightness(1.1); }
      .sensitive-badge { background: #ef4444; color: #fff; font-size: 11px; padding: 2px 6px; border-radius: 3px; margin-left: 8px; }
    `;
    shadow.appendChild(style);

    // Bar content
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.innerHTML = `
      <div class="msg"><strong>${title}</strong> ${message}${sensitive ? '<span class="sensitive-badge">SENSITIVE</span>' : ''}</div>
      <button data-choice="once">Allow once</button>
      ${!sensitive ? '<button data-choice="site" class="secondary">Allow for this site</button>' : ''}
      <button data-choice="deny" class="danger">Deny</button>
    `;
    shadow.appendChild(bar);

    const timer = setTimeout(() => {
      host.remove();
      resolve('deny');
    }, 120000);

    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      clearTimeout(timer);
      const choice = btn.dataset.choice;
      host.remove();
      resolve(choice);
    });
  });
}

async function askApproval(title, message, label = '', forceAsk = false) {
  const tab = await agentTab();
  const host = (() => { try { return new URL(tab.url).host; } catch { return ''; } })();

  const sensitive = /\b(submit|apply|pay|purchase|buy|place order|checkout|confirm|delete|remove|send|publish|post|transfer|withdraw|subscribe)\b/i.test(title + ' ' + message + ' ' + label);

  // Check allowedHosts in session storage
  const { allowedHosts = [] } = await chrome.storage.session.get('allowedHosts');
  if (!sensitive && !forceAsk && host && allowedHosts.includes(host)) {
    await log(`auto-approved on ${host}`);
    return true;
  }

  // Check autoApproveHosts in local storage (preset)
  const s = await settings();
  if (!sensitive && !forceAsk && host && (s.autoApproveHosts || []).some(h => host === h || host.endsWith('.' + h))) {
    await log(`auto-approved (preset) on ${host}`);
    return true;
  }

  // Show in-page approval bar
  try {
    await chrome.tabs.update(tab.id, { active: true });
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: showApprovalBar,
      args: [title, message, sensitive || forceAsk],
    });
    const choice = res?.result;

    if (choice === 'site') {
      allowedHosts.push(host);
      await chrome.storage.session.set({ allowedHosts });
      return true;
    }
    if (choice === 'once') return true;
    return false;
  } catch {
    // Fallback to notification for chrome:// pages etc.
    return askApprovalNotification(title, message);
  }
}

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
      const labelRes = await inPage(tab.id, pageLabel, [Number(p.element)]);
      const label = labelRes?.label || '';
      if (s.askBeforeActions && !(await askApproval('Arcwork wants to click', `${p.reason || 'Click element'} [${p.element}] on ${new URL(tab.url || 'about:blank').host}`, label))) {
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
    case 'tabs': {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const { agentTabId } = await chrome.storage.session.get('agentTabId');
      const lines = tabs.map(t => `[${t.id}] ${t.title || '(blank)'} (${t.url || 'about:blank'})`).join('\n');
      return { ok: true, result: `Tabs in this window:\n${lines}${agentTabId ? '\n(Agent tab: ' + agentTabId + ')' : ''}` };
    }
    case 'switch_tab': {
      const tabId = Number(p.tab_id);
      let tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch {
        return { ok: false, result: `No tab with id ${tabId}.` };
      }
      if (!tab.windowId) return { ok: false, result: `Tab ${tabId} not found.` };
      const newAgentTabId = await chrome.storage.session.set({ agentTabId: tabId });
      await chrome.tabs.update(tabId, { active: true });
      await log(`switched to [${tabId}]`);
      return { ok: true, result: `Switched to "${tab.title || ''}" (${tab.url || 'about:blank'}).` };
    }
    case 'close_tab': {
      const tabId = Number(p.tab_id);
      const tabs = await chrome.tabs.query({ currentWindow: true });
      if (tabs.length <= 1) return { ok: false, result: 'Cannot close the only tab in a window.' };
      if (s.askBeforeActions && !(await askApproval('Arcwork wants to close tab', `Close tab [${tabId}]?`))) {
        await log(`denied close [${tabId}]`);
        return { ok: false, result: 'The user denied closing this tab.' };
      }
      const { agentTabId } = await chrome.storage.session.get('agentTabId');
      if (tabId === Number(agentTabId)) {
        await chrome.storage.session.remove('agentTabId');
      }
      await chrome.tabs.remove(tabId);
      await log(`closed [${tabId}]`);
      return { ok: true, result: `Closed tab [${tabId}].` };
    }
    case 'key': {
      const tab = await agentTab();
      if (s.askBeforeActions && !(await askApproval('Arcwork wants to type a key', `${p.key} on ${p.element ? '['+p.element+']' : 'active element'}: ${p.reason || ''}`))) {
        await log(`denied key [${p.key}]`);
        return { ok: false, result: 'The user denied this keypress.' };
      }
      const r = await inPage(tab.id, pageKey, [String(p.key), p.element != null ? Number(p.element) : null]);
      await log(`key ${p.key}${p.element != null ? ' on ['+p.element+']' : ''}`);
      return r?.ok ? { ok: true, result: `Pressed ${p.key}.` } : { ok: false, result: r?.error || 'Key press failed.' };
    }
    case 'select': {
      const tab = await agentTab();
      if (s.askBeforeActions && !(await askApproval('Arcwork wants to select', `Select in [${p.element}]: "${p.value}" — ${p.reason || ''}`))) {
        await log(`denied select [${p.element}] "${p.value}"`);
        return { ok: false, result: 'The user denied this selection.' };
      }
      const r = await inPage(tab.id, pageSelect, [String(p.value), Number(p.element)]);
      await log(`select [${p.element}] "${p.value}"`);
      return r?.ok ? { ok: true, result: `Selected "${r.result}".` } : { ok: false, result: r?.error || 'Selection failed.' };
    }
    case 'hover': {
      const tab = await agentTab();
      const r = await inPage(tab.id, pageHover, [Number(p.element)]);
      await log(`hover [${p.element}]`);
      return r?.ok ? { ok: true, result: `Hovering "${r.label}". Call browser_read to see what appeared.` } : { ok: false, result: r?.error || 'Hover failed.' };
    }
    case 'drag': {
      const tab = await agentTab();
      if (s.askBeforeActions && !(await askApproval('Arcwork wants to drag', `Drag [${p.from_element}] onto [${p.to_element}] — ${p.reason || ''}`))) {
        await log(`denied drag`);
        return { ok: false, result: 'The user denied this drag.' };
      }
      const r = await inPage(tab.id, pageDrag, [Number(p.from_element), Number(p.to_element)]);
      await log(`drag [${p.from_element}] onto [${p.to_element}]`);
      return r?.ok ? { ok: true, result: 'Dragged.' } : { ok: false, result: r?.error || 'Drag failed.' };
    }
    case 'eval': {
      if (String(p.code).length > 400) return { ok: false, result: 'Script too long (max 400 characters) so the user can review all of it. Split it or use browser_read.' };
      const tab = await agentTab();
      if (!(await askApproval('Arcwork wants to run JavaScript', `${p.reason || 'Run script'}:\n${String(p.code)}`, '', true))) {
        await log('denied eval');
        return { ok: false, result: 'The user denied running this script.' };
      }
      const r = await evalInMain(tab.id, p.code);
      await log('eval ran');
      return r?.ok ? { ok: true, result: r.value } : { ok: false, result: 'Script error (some sites block eval with CSP): ' + (r?.error || 'unknown') };
    }
    case 'wait_for': {
      const tab = await agentTab();
      const text = p.text || '';
      const gone = Boolean(p.gone);
      const timeoutMs = Math.min((p.timeout_seconds || 10) * 1000, 30000);
      if (!text) {
        await waitForLoad(tab.id, 30000);
        await new Promise(res => setTimeout(res, 500));
        return { ok: true, result: 'Waited for page load.' };
      }
      const start = Date.now();
      let found = false;
      while (Date.now() - start < timeoutMs) {
        const ok = await inPage(tab.id, waitCheck, [text, gone]);
        if (ok) { found = true; break; }
        await new Promise(res => setTimeout(res, 400));
      }
      return { ok: true, result: found ? `Found "${text}".` : 'Timed out.' };
    }
    case 'find': {
      const tab = await agentTab();
      const snap = await inPage(tab.id, pageSnapshot, [Number(p.maxChars) || 15000]);
      if (!snap) return { ok: false, result: 'Could not read this page.' };
      const allElements = (snap.elements || '').split('\n').filter(l => l.trim());
      const matches = allElements.filter(line => line.toLowerCase().includes(String(p.query).toLowerCase())).slice(0, 20);
      if (matches.length === 0) return { ok: true, result: 'No match; call browser_read.' };
      return { ok: true, result: matches.join('\n') };
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
      await setStatus('connecting');
      await log('paired with Arcwork');
      pollLoop();
      sendResponse({ ok: true });
    } else if (msg.type === 'unpair') {
      await chrome.storage.local.remove('token');
      await chrome.storage.session.remove('allowedHosts');
      await setStatus('not paired');
      sendResponse({ ok: true });
    }
  })();
  return true;
});

pollLoop();

const $ = (id) => document.getElementById(id);
async function render() {
  const s = await chrome.storage.local.get(['server', 'token', 'status', 'askBeforeActions', 'activity']);
  const paired = Boolean(s.token);
  $('status').textContent = paired ? s.status || 'connecting' : 'not paired';
  $('status').className = 'pill' + (s.status === 'connected' ? ' ok' : '');
  $('pair').style.display = paired ? 'none' : 'block';
  $('paired').style.display = paired ? 'block' : 'none';
  $('server').value = $('server').value || s.server || 'https://shazam-opal.vercel.app';
  $('ask').checked = s.askBeforeActions !== false;
  $('activity').textContent = (s.activity || []).slice(-15).join('\n') || '—';
}
$('pairBtn').onclick = async () => {
  $('err').textContent = '';
  const r = await chrome.runtime.sendMessage({ type: 'pair', server: $('server').value.trim(), code: $('code').value.trim() });
  if (!r?.ok) $('err').textContent = r?.error || 'Pairing failed';
  render();
};
$('unpair').onclick = async () => { await chrome.runtime.sendMessage({ type: 'unpair' }); render(); };
$('ask').onchange = () => chrome.storage.local.set({ askBeforeActions: $('ask').checked });
chrome.storage.onChanged.addListener(render);
render();

#!/usr/bin/env node
/**
 * shazam-bridge — connect this computer to Arcwork so cloud agents can run commands,
 * edit files and use git (with your own credentials) inside folders you allow.
 *
 *   shazam-bridge pair <CODE> [--server https://arcwork-ai.vercel.app] [--name "My Mac"]
 *   shazam-bridge allow <folder>          # add a workspace folder
 *   shazam-bridge disallow <folder>
 *   shazam-bridge status
 *   shazam-bridge start [--yes-risky]     # run; risky commands are confirmed in this terminal
 */
const path = require('path');
const readline = require('readline');
const { BridgeClient, loadConfig, saveConfig, pair, CONFIG_PATH, DEFAULT_SERVER } = require('../desktop/bridge-core');

const [, , cmd, ...rest] = process.argv;
const flag = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};

function ask(question) {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(/^y(es)?$/i.test(a.trim())); }));
}

(async () => {
  const cfg = loadConfig();
  switch (cmd) {
    case 'pair': {
      const code = rest[0];
      if (!code) throw new Error('Usage: shazam-bridge pair <CODE>  (get a code in Arcwork → Connections → Desktop app)');
      const device = await pair(flag('--server') || cfg.server || DEFAULT_SERVER, code, flag('--name'));
      console.log(`✓ Paired as "${device.name}". Config saved to ${CONFIG_PATH}`);
      console.log('Next: shazam-bridge allow <project folder>  then  shazam-bridge start');
      break;
    }
    case 'allow': {
      const dir = path.resolve(rest[0] || process.cwd());
      cfg.workspaces = Array.from(new Set([...(cfg.workspaces || []), dir]));
      saveConfig(cfg);
      console.log(`✓ Allowed ${dir}`);
      break;
    }
    case 'disallow': {
      const dir = path.resolve(rest[0] || process.cwd());
      cfg.workspaces = (cfg.workspaces || []).filter((w) => w !== dir);
      saveConfig(cfg);
      console.log(`✓ Removed ${dir}`);
      break;
    }
    case 'status':
      console.log(JSON.stringify({ server: cfg.server, paired: Boolean(cfg.token), device: cfg.deviceName, workspaces: cfg.workspaces }, null, 2));
      break;
    case 'start': {
      const yesRisky = rest.includes('--yes-risky');
      let lastStatus = '';
      if (!cfg.workspaces?.length) console.warn('! No folders allowed yet. Run: shazam-bridge allow <folder>');
      const client = new BridgeClient({
        config: cfg,
        approve: async (summary, detail) => yesRisky || ask(`\n⚠ ${summary}:\n  ${detail.replace(/\n/g, '\n  ')}\nAllow? [y/N] `),
        log: (l) => console.log(l),
        // Print only changes; the long-poll reconnects every ~20s and would repeat "connected".
        onStatus: (s) => { if (s !== lastStatus) console.log(`[bridge] ${s}`); lastStatus = s; },
      });
      process.on('SIGINT', () => { client.stop(); process.exit(0); });
      console.log(`Arcwork bridge → ${cfg.server}  (folders: ${(cfg.workspaces || []).join(', ') || 'none'})`);
      await client.start();
      break;
    }
    default:
      console.log('Usage: shazam-bridge <pair|allow|disallow|status|start>');
  }
})().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});

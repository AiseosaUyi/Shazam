# arcwork-bridge

Lets [Arcwork](https://arcwork-ai.vercel.app)'s agents edit and run code in folders you allow on your computer. No dependencies, Node 18+.

```sh
npx arcwork-bridge pair CODE          # code from Arcwork → Connections → Devices
npx arcwork-bridge allow ~/Projects   # only allowed folders are reachable
npx arcwork-bridge start              # keep this running while you work
```

Other commands: `disallow <dir>`, `status`. Risky commands ask you in the terminal before they run. Settings live in `~/.shazam/bridge.json`.

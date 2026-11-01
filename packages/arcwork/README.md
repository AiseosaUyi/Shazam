# arcwork

Connect your computer to [Arcwork](https://arcwork-ai.vercel.app) so its agents can work in folders you allow.

```bash
npx arcwork connect
```

Run it inside a project folder. It opens your browser to approve the connection, allows that folder, and keeps running in the background. Arcwork asks you on your computer before using any other folder and before risky commands (push, delete, publish).

```bash
npx arcwork status   # connected account, running state, allowed folders
npx arcwork stop     # stop the background connection
```

Generated from `cli/bridge.js` + `desktop/bridge-core.js` by `scripts/gen-bridge.mjs`. No dependencies.

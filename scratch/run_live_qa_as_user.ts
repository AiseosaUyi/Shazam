import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const userId = '3796a56c-114b-431e-b27b-98821da40e08'; // aiseosauyiidahor@gmail.com
const rawToken = crypto.randomBytes(32).toString('hex');
const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
const now = new Date().toISOString();
const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

console.log('Generating session token for human user:', userId);
console.log('Raw Token:', rawToken);
console.log('Token Hash:', tokenHash);

// Insert session into remote D1
const sql = `INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('${tokenHash}', '${userId}', '${now}', '${expiresAt}');`;
try {
  execSync(`npx wrangler d1 execute shazam-db --remote --command="${sql}"`, { stdio: 'inherit' });
  console.log('Session inserted successfully into remote D1!');
} catch (err: any) {
  console.error('Failed to insert session into remote D1:', err.message);
  process.exit(1);
}

// Now test live worker endpoints with this cookie
const baseUrl = 'https://shazam-ai.aiseosauyi-idahor.workers.dev';
const cookie = `shazam_session=${rawToken}`;

async function runLiveQAFlows() {
  console.log('\n--- 1. Authenticating as Human User on Live Production ---');
  const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Cookie: cookie },
  });
  console.log('/api/v1/auth/me status:', meRes.status);
  const meData = await meRes.json();
  console.log('Logged in user:', meData);

  console.log('\n--- 2. Fetching User Projects from Live Production ---');
  const projRes = await fetch(`${baseUrl}/api/v1/projects`, {
    headers: { Cookie: cookie },
  });
  const projData = await projRes.json();
  console.log('User projects found:', projData.projects?.map((p: any) => ({ id: p.id, name: p.name })));

  const zoqoProj = projData.projects?.find((p: any) => p.name.toLowerCase() === 'zoqo');
  if (!zoqoProj) {
    console.error('Zoqo project not found for user!');
    return;
  }

  console.log('\n--- 3. Fetching Files in Zoqo Project ---');
  const filesRes = await fetch(`${baseUrl}/api/v1/projects/${zoqoProj.id}/files`, {
    headers: { Cookie: cookie },
  });
  const filesData = await filesRes.json();
  console.log(`Found ${filesData.files?.length || 0} indexed files in Zoqo!`);
  if (filesData.files?.length > 0) {
    console.log('First 5 files:', filesData.files.slice(0, 5).map((f: any) => f.path));
  }

  console.log('\n--- 4. Executing LIVE Zoqo Coding / Digestion Task on Production Worker ---');
  const codingTaskPrompt = 'Can you digest what Zoqo is all about based on the project files in this workspace?';
  const taskRes = await fetch(`${baseUrl}/api/v1/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      Origin: baseUrl,
    },
    body: JSON.stringify({
      prompt: codingTaskPrompt,
      projectId: zoqoProj.id,
      taskClassOverride: 'coding',
    }),
  });

  console.log('/api/v1/tasks response status:', taskRes.status);
  if (!taskRes.ok) {
    const errText = await taskRes.text();
    console.error('Task execution failed:', errText);
    return;
  }

  const reader = taskRes.body?.getReader();
  if (reader) {
    const decoder = new TextDecoder();
    let fullOutput = '';
    let selectedRoute: any = null;

    let isTaskDone = false;
    while (!isTaskDone) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.route) selectedRoute = data.route;
            if (data.type === 'route_selected') selectedRoute = data;
            if (data.text) fullOutput += data.text;
            if (data.type === 'done' || data.type === 'error') {
              isTaskDone = true;
              break;
            }
          } catch {}
        }
      }
    }

    console.log('Selected Model Route:', selectedRoute?.modelId || selectedRoute?.id || 'dynamic');
    console.log('Assistant Output length:', fullOutput.length, 'characters');
    console.log('\n[PREVIEW OF REAL ZOQO DIGESTION OUTPUT FROM PRODUCTION]:\n');
    console.log(fullOutput.slice(0, 600) + (fullOutput.length > 600 ? '\n... [truncated]' : ''));
  }

  console.log('\n--- 5. Executing LIVE Normal ChatGPT Task on Production Worker ---');
  const generalRes = await fetch(`${baseUrl}/api/v1/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      Origin: baseUrl,
    },
    body: JSON.stringify({
      prompt: 'Explain quantum computing in simple terms with a real-world analogy.',
      taskClassOverride: 'general_chat',
    }),
  });

  console.log('General chat status:', generalRes.status);
  const generalReader = generalRes.body?.getReader();
  if (generalReader) {
    const decoder = new TextDecoder();
    let generalOutput = '';
    let isGeneralDone = false;
    while (!isGeneralDone) {
      const { done, value } = await generalReader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.text) generalOutput += data.text;
            if (data.type === 'done' || data.type === 'error') {
              isGeneralDone = true;
              break;
            }
          } catch {}
        }
      }
    }
    console.log('General Chat Output preview:', generalOutput.slice(0, 300) + '...');
  }

  console.log('\n--- 6. Executing LIVE Co-Work Task to aise@gruve.events ---');
  const coworkPrompt = 'Send an email to aise@gruve.events with subject Launch Deliverables updating him that Zoqo v2 is ready for deployment';
  const coworkRes = await fetch(`${baseUrl}/api/v1/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      Origin: baseUrl,
    },
    body: JSON.stringify({
      prompt: `[Autonomous Co-Work Mode | Active Skills: gmail, browser, notion]\n${coworkPrompt}`,
      taskClassOverride: 'planning',
    }),
  });

  console.log('Co-Work status:', coworkRes.status);
  const coworkReader = coworkRes.body?.getReader();
  if (coworkReader) {
    const decoder = new TextDecoder();
    let coworkOutput = '';
    let isCoworkDone = false;
    while (!isCoworkDone) {
      const { done, value } = await coworkReader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.text) coworkOutput += data.text;
            if (data.type === 'done' || data.type === 'error') {
              isCoworkDone = true;
              break;
            }
          } catch {}
        }
      }
    }
    console.log('Co-Work Email Body preview:\n', coworkOutput.slice(0, 400) + '...');
  }
}

runLiveQAFlows().catch(console.error);

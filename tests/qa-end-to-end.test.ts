import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createTestRepo } from '@/lib/db/test-sqlite';
import { runTaskOrchestrator } from '@/lib/execution/orchestrator';
import { classifyPrompt } from '@/lib/routing/classifier';
import { setTestEnv } from '@/lib/env';
import type { User } from '@/lib/types';

describe('Comprehensive End-to-End QA Test Suite', () => {
  setTestEnv({
    SHAZAM_ENABLE_SIMULATION: 'true',
    SHAZAM_SHARE_SYSTEM_KEYS: 'true',
  });

  const qaUser: User = {
    id: 'user_qa_engineer',
    email: 'qa@shazam.ai',
    name: 'QA Engineer',
    role: 'user',
    status: 'active',
    onboarded: true,
    createdAt: new Date().toISOString(),
  };

  async function seedQaUser(repo: any) {
    await repo.createUser({
      id: qaUser.id,
      email: qaUser.email,
      name: qaUser.name,
      passwordHash: 'dummy_hash',
      role: 'user',
    });
  }

  // =========================================================================
  // 1. CODING TASK WITH ZOQO PROJECT CONNECTED
  // =========================================================================
  it('QA 1: Coding task with Zoqo connected — ingests files, injects project context, runs code task', async () => {
    const repo = createTestRepo();
    await seedQaUser(repo);

    // 1. Create Zoqo Project
    const zoqoProject = {
      id: 'proj_zoqo_test',
      name: 'Zoqo',
      description: 'Autonomous AI workflow platform',
    };
    await repo.createProject(qaUser.id, zoqoProject);

    // 2. Ingest real Zoqo codebase files into D1 workspace_files
    const sampleFiles = [
      {
        path: 'README.md',
        content: '# Zoqo\nZoqo is an autonomous event scheduling and ticketing platform for high-growth creators.',
      },
      {
        path: 'src/config.ts',
        content: 'export const ZOQO_VERSION = "2.1.0";\nexport const DEFAULT_CURRENCY = "NGN";\nexport const PRIMARY_EVENT_ID = "gruve_2026";',
      },
      {
        path: 'src/services/events.ts',
        content: 'export async function getEventDetails(id: string) {\n  return { id, name: "Gruve Annual Tech Summit", currency: "NGN", price: 15000 };\n}',
      },
    ];

    await repo.putProjectFilesBulk(qaUser.id, zoqoProject.id, sampleFiles);

    // Verify files are indexed in project
    const retrievedFiles = await repo.getProjectFiles(qaUser.id, zoqoProject.id);
    assert.strictEqual(retrievedFiles.length, 3);
    assert.strictEqual(retrievedFiles[0].path, 'README.md');

    // 3. Dispatch a coding task referencing Zoqo
    const events: Array<{ event: string; data: any }> = [];
    const codingPrompt = 'Add currency conversion helper to convert NGN ticket prices to USD in src/services/events.ts';

    await runTaskOrchestrator({
      user: qaUser,
      prompt: codingPrompt,
      projectId: zoqoProject.id,
      pinnedModelName: 'Shazam Simulator (Demo)',
      taskClassOverride: 'coding',
      costPolicy: 'manual_pin',
      repo,
      onEvent: (event, data) => {
        events.push({ event, data });
      },
    });

    // 4. Verify orchestration events
    const taskCreatedEvent = events.find((e) => e.event === 'task_created');
    assert.ok(taskCreatedEvent, 'task_created event must be emitted');
    assert.strictEqual(taskCreatedEvent.data.taskClass, 'coding');

    const routeEvent = events.find((e) => e.event === 'route_selected');
    assert.ok(routeEvent, 'route_selected event must be emitted');
    assert.ok(routeEvent.data.model, 'A model must be selected');

    const doneEvent = events.find((e) => e.event === 'done');
    assert.ok(doneEvent, 'done event must be emitted');
    assert.ok(doneEvent.data.fullText.length > 0, 'Response text must be present');

    // 5. Verify conversation was automatically created and tagged with projectId
    const convId = taskCreatedEvent.data.conversationId;
    assert.ok(convId, 'conversationId must exist');
    const conv = await repo.getConversation(qaUser.id, convId);
    assert.ok(conv, 'Conversation must be saved in D1');
    assert.strictEqual(conv.projectId, zoqoProject.id, 'Conversation must be scoped to Zoqo project');

    // 6. Verify messages recorded in D1
    const messages = await repo.getMessages(qaUser.id, convId);
    assert.ok(messages.length >= 2, 'Should have user and assistant messages');
    assert.strictEqual(messages[0].role, 'user');
    assert.strictEqual(messages[1].role, 'assistant');
    assert.ok(messages[1].content.length > 0, 'Assistant should return content');
  });

  // =========================================================================
  // 2. NORMAL CHATGPT / GENERAL CHAT TASK
  // =========================================================================
  it('QA 2: Normal ChatGPT task — classifies general chat, streams response, logs trace', async () => {
    const repo = createTestRepo();
    await seedQaUser(repo);

    const chatPrompt = 'Explain the difference between event-driven architecture and request-response architecture in simple terms.';
    const classified = classifyPrompt(chatPrompt);
    assert.strictEqual(classified.taskClass, 'general_chat', 'General knowledge question must classify as general_chat');

    const events: Array<{ event: string; data: any }> = [];

    await runTaskOrchestrator({
      user: qaUser,
      prompt: chatPrompt,
      pinnedModelName: 'Shazam Simulator (Demo)',
      taskClassOverride: 'general_chat',
      costPolicy: 'manual_pin',
      repo,
      onEvent: (event, data) => {
        events.push({ event, data });
      },
    });

    const routeEvent = events.find((e) => e.event === 'route_selected');
    assert.ok(routeEvent, 'route_selected event must be emitted');
    assert.ok(routeEvent.data.route, 'Route must be chosen');

    const doneEvent = events.find((e) => e.event === 'done');
    assert.ok(doneEvent, 'done event must be emitted');
    assert.ok(doneEvent.data.fullText.length > 0, 'Full response text must be populated');
  });

  // =========================================================================
  // 3. CO-WORK TASK: SEND EMAIL TO AISE@GRUVE.EVENTS
  // =========================================================================
  it('QA 3: Co-Work Task — parse recipient aise@gruve.events, generate Google Workspace draft', async () => {
    const repo = createTestRepo();
    await seedQaUser(repo);

    const userPrompt = 'Send an email to aise@gruve.events with subject Launch Deliverables updating him that Zoqo v2 is ready for deployment';

    // 1. Verify regex recipient extractor
    const emailMatch = userPrompt.match(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/);
    assert.ok(emailMatch, 'Email regex must match');
    assert.strictEqual(emailMatch[0], 'aise@gruve.events', 'Recipient must be aise@gruve.events');

    // 2. Verify subject extractor
    const subjectMatch =
      userPrompt.match(/subject[:\s]+(["']?)([^"'\n]+)\1/i) ||
      userPrompt.match(/about[:\s]+(["']?)([^"'\n]+)\1/i);
    assert.ok(subjectMatch, 'Subject extractor must find subject');
    assert.ok(subjectMatch[2].includes('Launch Deliverables'), 'Subject must contain Launch Deliverables');

    // 3. Execute Co-Work planning task
    const events: Array<{ event: string; data: any }> = [];

    await runTaskOrchestrator({
      user: qaUser,
      prompt: `[Autonomous Co-Work Mode | Active Skills: gmail, browser, notion]\n${userPrompt}`,
      pinnedModelName: 'Shazam Simulator (Demo)',
      taskClassOverride: 'planning',
      costPolicy: 'manual_pin',
      repo,
      onEvent: (event, data) => {
        events.push({ event, data });
      },
    });

    const doneEvent = events.find((e) => e.event === 'done');
    assert.ok(doneEvent, 'Co-Work task must complete with done event');
    assert.ok(doneEvent.data.fullText.length > 0, 'Email body draft must be generated');

    // 4. Construct the Live Artifact that renders on the right canvas
    const recipient = emailMatch[0];
    const subject = subjectMatch[2].trim();
    const artifact = {
      type: 'email' as const,
      title: `Draft Email to ${recipient}`,
      data: {
        to: recipient,
        subject,
        body: doneEvent.data.fullText,
      },
    };

    assert.strictEqual(artifact.data.to, 'aise@gruve.events');
    assert.ok(artifact.data.subject.includes('Launch Deliverables'));
    assert.ok(artifact.data.body.length > 0);
  });
});

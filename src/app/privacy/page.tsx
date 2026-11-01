import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDoc, PublicShell } from '@/components/public/PublicShell';
import { BRAND_NAME, CONTACT_EMAIL, LEGAL_EFFECTIVE_DATE, LEGAL_ENTITY } from '@/lib/brand';

export const metadata: Metadata = { title: `Privacy Policy · ${BRAND_NAME}` };

export default function PrivacyPage() {
  return (
    <PublicShell>
      <LegalDoc title="Privacy Policy" updated={LEGAL_EFFECTIVE_DATE}>
        <p>
          {BRAND_NAME} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is operated by {LEGAL_ENTITY}. {BRAND_NAME} gives you AI agents that write code, handle email and
          calendar tasks, chat, and make images and video. This policy explains what we collect, why, who we share it with, and the choices you have.
          In short: we use your data only to run the features you ask for. We do not sell it, show you ads, or use it to train AI models.
        </p>

        <h2>1. What we collect</h2>
        <ul>
          <li><strong>Account details:</strong> your email address, name, and a salted hash of your password (never the password itself).</li>
          <li><strong>What you give the agents:</strong> your messages, instructions, files and projects, and the code, documents, images and videos the agents produce for you.</li>
          <li><strong>Keys you add:</strong> API keys for AI providers (such as Google Gemini, OpenRouter, Groq, Cerebras, Anthropic, OpenAI or DeepSeek) and access tokens for apps you connect (such as GitHub or MCP servers). These are encrypted with AES-256-GCM before they are stored.</li>
          <li><strong>Connected Google account:</strong> if you connect Gmail and Google Calendar, see section 4.</li>
          <li><strong>Connected devices:</strong> if you pair the desktop app, command-line bridge or browser extension, we store the device name, a hashed device token and the folders you allowed. Commands run on your device only inside folders you allowed.</li>
          <li><strong>Usage records:</strong> which model ran each task, token counts, estimated cost, run steps and errors, so we can show you activity, switch models when a free limit is hit, and fix problems.</li>
          <li><strong>Technical data:</strong> your IP address (used briefly for rate limiting and abuse prevention) and essential cookies: a session cookie that keeps you signed in, an encrypted backup of your saved keys, and short-lived cookies that secure sign-in flows. We do not use advertising or tracking cookies.</li>
          <li><strong>Early-access list:</strong> if you join it, your email, optional name and what you want to use {BRAND_NAME} for.</li>
        </ul>

        <h2>2. How we use it</h2>
        <ul>
          <li>To run the tasks you request: sending your instructions and the needed context to an AI model, running code in a sandbox or on your paired device, and carrying out actions you approve.</li>
          <li>To keep your work available across devices: chats, projects, skills, schedules and generated media.</li>
          <li>To keep the service working and safe: rate limits, abuse prevention, debugging and security.</li>
          <li>To contact you about your account, early access, or important changes. No marketing email without your consent.</li>
        </ul>

        <h2>3. AI model providers</h2>
        <p>
          To answer a request, {BRAND_NAME} sends your instructions and the relevant context to the AI model that runs the task. That is either a free
          model we provide through Vercel AI Gateway, or a provider whose key you added. If you choose a local model on your own computer, the
          request stays on your computer. Each provider handles that data under its own terms. Some free tiers, including the free Google Gemini
          API tier, allow the provider to use requests to improve its models; use a paid key or a local model for sensitive work.
        </p>

        <h2>4. Google user data (Gmail and Google Calendar)</h2>
        <p>
          If you choose to connect Google, {BRAND_NAME} requests permission to send email, manage drafts, read your messages and settings, and view and
          edit calendar events. We use this access only to do what you ask the Co-Work agent to do, for example &ldquo;summarize my unread email&rdquo;,
          &ldquo;draft a reply&rdquo;, &ldquo;send this on Monday at 9am&rdquo; or &ldquo;find a free slot and add a meeting&rdquo;. Sending email and
          creating events always waits for your approval.
        </p>
        <p>
          {BRAND_NAME}&apos;s use and transfer to any other app of information received from Google APIs will adhere to the{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>,
          including the Limited Use requirements. Specifically:
        </p>
        <ul>
          <li>We use Google data only to provide and improve the user-facing features you request in {BRAND_NAME}.</li>
          <li>We transfer Google data only as needed to provide those features (for example, to the AI model that runs your request), for security, to comply with law, or as part of a merger or acquisition with your notice.</li>
          <li>We do not use Google data to serve ads, and we do not sell it.</li>
          <li>We do not use Google data to train or improve general-purpose AI or machine-learning models.</li>
          <li>No person at {BRAND_NAME} reads your Google data unless you ask us to (for example in a support request), it is necessary for security or abuse investigation, or the law requires it.</li>
        </ul>
        <p>
          Google access and refresh tokens are encrypted at rest. Email and calendar content is fetched when a task needs it and is kept only as part
          of the conversation or task where you asked for it. You can disconnect Google at any time in Connections, and revoke access at{' '}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">myaccount.google.com/permissions</a>.
        </p>

        <h2>5. Who we share data with</h2>
        <p>We share data only with service providers that run {BRAND_NAME} for you:</p>
        <ul>
          <li><strong>Vercel:</strong> hosting, file storage for generated media, code sandboxes and the AI Gateway for free models.</li>
          <li><strong>Turso:</strong> our database.</li>
          <li><strong>AI model providers:</strong> the provider that runs each request, as described in section 3.</li>
          <li><strong>Apps you connect:</strong> Google, GitHub or MCP servers, only when an agent acts there for you.</li>
        </ul>
        <p>We may also disclose data if the law requires it or to protect the safety of our users and service.</p>

        <h2>6. Security</h2>
        <p>
          Keys and tokens are encrypted with AES-256-GCM, passwords are hashed, traffic is encrypted with TLS, device tokens are stored hashed, and
          every database query is scoped to your account. No system is perfectly secure; if a breach affects your data we will notify you as the law requires.
        </p>

        <h2>7. Keeping and deleting your data</h2>
        <p>
          We keep your data while your account is open. You can delete your account at any time in <Link href="/settings">Settings</Link>. That
          immediately deletes your account, conversations, projects, keys, connected accounts, schedules and generated media files. Copies in our
          providers&apos; routine backups expire on their normal schedule. You can also delete individual chats, keys and connections at any time.
        </p>

        <h2>8. Your rights</h2>
        <p>
          Depending on where you live, you may have the right to access, correct, export or delete your personal data, and to object to or restrict
          some processing. Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we will respond within 30 days. You may also complain to
          your local data protection authority.
        </p>

        <h2>9. International transfers</h2>
        <p>
          Our providers may process data in the United States and other countries. Where required, we rely on appropriate safeguards such as standard
          contractual clauses.
        </p>

        <h2>10. Children</h2>
        <p>{BRAND_NAME} is not for children under 16, and we do not knowingly collect their data.</p>

        <h2>11. Changes</h2>
        <p>If we make material changes we will update this page and tell you in the app or by email before they take effect.</p>

        <h2>12. Contact</h2>
        <p>
          Questions or requests: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </LegalDoc>
    </PublicShell>
  );
}

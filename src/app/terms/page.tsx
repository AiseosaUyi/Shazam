import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDoc, PublicShell } from '@/components/public/PublicShell';
import { BRAND_NAME, CONTACT_EMAIL, LEGAL_EFFECTIVE_DATE, LEGAL_ENTITY } from '@/lib/brand';

export const metadata: Metadata = { title: `Terms of Service · ${BRAND_NAME}` };

export default function TermsPage() {
  return (
    <PublicShell>
      <LegalDoc title="Terms of Service" updated={LEGAL_EFFECTIVE_DATE}>
        <p>
          These terms are an agreement between you and {LEGAL_ENTITY} for your use of {BRAND_NAME}. By creating an account or using {BRAND_NAME} you
          agree to them and to our <Link href="/privacy">Privacy Policy</Link>. If you do not agree, please do not use the service.
        </p>

        <h2>1. The service</h2>
        <p>
          {BRAND_NAME} provides AI agents that write and run code, help with email and calendar, chat, and generate images and video. {BRAND_NAME} is
          currently free to use. Free models have daily limits set by their providers, and we may change, limit or discontinue features, models or
          limits at any time. Some features, such as Gmail and Google Calendar, are in early access and may be available only to approved accounts.
        </p>

        <h2>2. Your account</h2>
        <ul>
          <li>You must be at least 16 years old and give accurate account information.</li>
          <li>You are responsible for keeping your password, API keys, device pairing codes and access tokens secure, and for activity under your account.</li>
          <li>Tell us promptly at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> if you believe your account has been compromised.</li>
        </ul>

        <h2>3. Your keys and third-party services</h2>
        <p>
          You can add your own keys for AI providers and connect services such as Google, GitHub, MCP servers, or your own computer. When you do,
          {' '}{BRAND_NAME} uses them on your behalf, and your use of those services is governed by their own terms. Any charges a provider bills to
          your key are your responsibility. We are not responsible for third-party services, their availability or their output.
        </p>

        <h2>4. Agents act for you</h2>
        <ul>
          <li>Agents follow your instructions. Actions that reach outside {BRAND_NAME}, such as sending email, creating calendar events, pushing code or running risky commands on your computer, ask for your approval first. Review them before you approve.</li>
          <li>You are responsible for the instructions you give, the actions you approve, and how you use the results.</li>
          <li>AI output can be wrong, incomplete or insecure. Check code, facts and messages before relying on them, especially for legal, medical, financial or safety-critical decisions.</li>
        </ul>

        <h2>5. Acceptable use</h2>
        <p>You agree not to use {BRAND_NAME} to:</p>
        <ul>
          <li>break the law or infringe anyone&apos;s rights, including intellectual property and privacy;</li>
          <li>send spam, bulk unsolicited email, phishing or deceptive messages;</li>
          <li>create malware, attack systems, or access accounts, devices or data without permission;</li>
          <li>generate content that sexualizes minors, promotes violence or harassment, or impersonates real people to deceive;</li>
          <li>get around usage limits, share accounts to multiply free limits, or overload the service; or</li>
          <li>break the usage policies of the AI providers whose models run your requests.</li>
        </ul>
        <p>We may suspend or remove accounts and content that break these rules.</p>

        <h2>6. Your content</h2>
        <p>
          You keep ownership of what you put into {BRAND_NAME} and, to the extent the law allows, of the output the agents produce for you. You give us
          permission to store, process and transmit your content only as needed to run the service for you, as described in the Privacy Policy. We do
          not use your content to train AI models.
        </p>

        <h2>7. Our service</h2>
        <p>
          {BRAND_NAME}, its software, design and brand belong to us and our licensors. Do not copy, resell or reverse engineer the service except as the
          law allows. If you send us feedback, we may use it without obligation to you.
        </p>

        <h2>8. Ending your use</h2>
        <p>
          You can stop using {BRAND_NAME} and delete your account at any time in <Link href="/settings">Settings</Link>. We may suspend or end access if
          you break these terms, if required by law, or if we discontinue the service, and we will try to give you notice where reasonable.
        </p>

        <h2>9. Disclaimers</h2>
        <p>
          {BRAND_NAME} is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind, including fitness for a particular
          purpose, accuracy, availability or non-infringement, to the fullest extent the law allows.
        </p>

        <h2>10. Limitation of liability</h2>
        <p>
          To the fullest extent the law allows, we are not liable for indirect, incidental, special, consequential or punitive damages, or for lost
          profits, data or goodwill. Because {BRAND_NAME} is provided free of charge, our total liability for any claim relating to the service is limited
          to USD 100. Nothing in these terms limits liability that cannot be limited by law.
        </p>

        <h2>11. Changes to these terms</h2>
        <p>
          We may update these terms. If a change is material we will tell you in the app or by email before it takes effect. Continuing to use
          {' '}{BRAND_NAME} after that means you accept the updated terms.
        </p>

        <h2>12. Contact</h2>
        <p>
          Questions about these terms: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </LegalDoc>
    </PublicShell>
  );
}

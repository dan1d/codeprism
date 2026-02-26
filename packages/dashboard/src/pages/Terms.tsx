import { Link } from "react-router-dom";

export function Terms() {
  return (
    <div className="min-h-screen bg-[#0d1117]">
      {/* Simple top nav */}
      <header className="border-b border-[#21262d] px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm font-bold text-[#e1e4e8]">
            ← <span className="text-accent">codeprism</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-bold text-[#e1e4e8] mb-2">Terms of Service</h1>
        <p className="text-sm text-[#484f58] mb-12">Last updated: February 2026</p>

        <div className="prose prose-invert max-w-none space-y-10 text-[#8b949e] text-sm leading-7">

          <section>
            <h2 className="text-lg font-semibold text-[#e1e4e8] mb-3">1. Acceptance</h2>
            <p>
              By using codeprism (the "Service") — including codeprism.dev and any self-hosted
              instance of the engine — you agree to these Terms. If you are using codeprism on
              behalf of a company or team, you represent that you have authority to bind that
              organization to these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#e1e4e8] mb-3">2. The Service</h2>
            <p>
              codeprism provides a persistent knowledge layer for AI coding tools. It indexes
              your codebase into a knowledge graph and serves context to MCP-compatible editors
              such as Cursor, Claude Code, Windsurf, and others.
            </p>
            <p className="mt-3">
              The engine is released under the{" "}
              <a
                href="https://github.com/dan1d/codeprism/blob/main/LICENSE"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                AGPL-3.0 license
              </a>
              . Client libraries and CLI tools are MIT licensed. The hosted cloud service
              (codeprism.dev) is a proprietary service built on the open-source engine.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#e1e4e8] mb-3">3. Your Code & Data</h2>
            <p>
              Your source code is yours. codeprism processes your code locally (self-hosted) or
              within your isolated cloud tenant. We do not access, store, or transmit your source
              code to third parties.
            </p>
            <p className="mt-3">
              For the hosted service, your data is stored in a tenant-isolated SQLite database.
              You may export or delete your data at any time from the dashboard Settings page.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#e1e4e8] mb-3">4. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 pl-2">
              <li>Use the Service to index code you do not have the right to process.</li>
              <li>Attempt to access other tenants' data or circumvent access controls.</li>
              <li>Use the Service to generate, distribute, or store malicious code.</li>
              <li>Abuse the API in ways that degrade service for other users.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#e1e4e8] mb-3">5. LLM Usage</h2>
            <p>
              codeprism optionally calls third-party LLM APIs (Gemini, OpenAI, Anthropic,
              DeepSeek) to enrich knowledge cards. When you provide an API key, requests are
              made directly from your instance to the LLM provider using your key. codeprism
              does not proxy or log these requests.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#e1e4e8] mb-3">6. Founding Team Offer</h2>
            <p>
              The founding team offer (up to 10 developers free) is available to the first 100
              teams who sign up on codeprism.dev. This offer may change after the founding period
              ends. Existing founding members will receive advance notice of any pricing changes
              with no less than 30 days notice.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#e1e4e8] mb-3">7. Disclaimers</h2>
            <p>
              THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND. codeprism makes no
              guarantees about uptime, accuracy of knowledge cards, or fitness for a particular
              purpose. AI-generated content can be incorrect — always verify architectural
              decisions from codeprism with your own judgment.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#e1e4e8] mb-3">8. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, codeprism's liability for any claim
              arising out of use of the Service is limited to the amount you paid us in the
              three months preceding the claim, or $100, whichever is greater.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#e1e4e8] mb-3">9. Changes</h2>
            <p>
              We may update these Terms. Material changes will be announced in the{" "}
              <a href="https://discord.gg/nsWERSde" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                Discord community
              </a>{" "}
              and via email to registered users at least 14 days before taking effect.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#e1e4e8] mb-3">10. Contact</h2>
            <p>
              Questions about these Terms?{" "}
              <a href="mailto:support@codeprism.dev" className="text-accent hover:underline">
                support@codeprism.dev
              </a>
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t border-[#21262d] px-6 py-6 mt-8">
        <p className="text-center text-xs text-[#484f58]">
          © {new Date().getFullYear()} codeprism ·{" "}
          <Link to="/" className="hover:text-[#8b949e] transition-colors">Home</Link>
          {" · "}
          <a href="https://github.com/dan1d/codeprism/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" className="hover:text-[#8b949e] transition-colors">
            AGPL-3.0 License
          </a>
        </p>
      </footer>
    </div>
  );
}

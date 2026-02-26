const RESEND_API_KEY = process.env["CODEPRISM_RESEND_API_KEY"];
const CODEPRISM_DOMAIN = process.env["CODEPRISM_DOMAIN"] ?? "localhost:4000";
const FROM_EMAIL = process.env["CODEPRISM_FROM_EMAIL"] ?? "codeprism <noreply@codeprism.dev>";
const SUPPORT_EMAIL = process.env["CODEPRISM_SUPPORT_EMAIL"] ?? "support@codeprism.dev";

const EMAIL_FOOTER = `
  <div style="border-top: 1px solid #21262d; margin-top: 32px; padding-top: 16px;">
    <p style="color: #484f58; font-size: 11px; margin: 0;">
      Need help? Reach out at <a href="mailto:${SUPPORT_EMAIL}" style="color: #58a6ff;">${SUPPORT_EMAIL}</a>
    </p>
  </div>
`;

const isLocalhost = CODEPRISM_DOMAIN.startsWith("localhost");
const protocol = isLocalhost ? "http" : "https";

function getBaseUrl(): string {
  return `${protocol}://${CODEPRISM_DOMAIN}`;
}

/**
 * Returns the tenant-scoped base URL.
 * On localhost: http://localhost:4000  (no subdomains in dev)
 * In production: https://gobiobridge.codeprism.dev
 */
function getTenantBaseUrl(tenantSlug: string): string {
  if (isLocalhost) return getBaseUrl();
  return `${protocol}://${tenantSlug}.${CODEPRISM_DOMAIN}`;
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) {
    console.log(`[email] (dev mode) To: ${to}\nSubject: ${subject}\n${html}\n`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    console.error(`[email] Failed to send to ${to}: ${res.status} ${text}`);
  }
}

export async function sendMagicLinkEmail(
  email: string,
  token: string,
  tenantSlug: string,
  tenantName: string,
): Promise<void> {
  const link = `${getTenantBaseUrl(tenantSlug)}/auth/verify?token=${encodeURIComponent(token)}&tenant=${encodeURIComponent(tenantSlug)}`;

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 0;">
      <h2 style="color: #e1e4e8; font-size: 20px;">Sign in to codeprism</h2>
      <p style="color: #8b949e; font-size: 14px;">
        Click the button below to sign in to <strong>${tenantName}</strong> on codeprism.
      </p>
      <a href="${link}" style="display: inline-block; background: #58a6ff; color: #0d1117; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px; margin: 16px 0;">
        Sign in to codeprism
      </a>
      <p style="color: #484f58; font-size: 12px; margin-top: 24px;">
        This link expires in 15 minutes. If you didn't request this, you can safely ignore this email.
      </p>
      ${EMAIL_FOOTER}
    </div>
  `;

  await sendEmail(email, `Sign in to ${tenantName} on codeprism`, html);
}

export async function sendInvitationEmail(
  email: string,
  token: string,
  tenantSlug: string,
  tenantName: string,
  inviterEmail?: string,
): Promise<void> {
  const link = `${getTenantBaseUrl(tenantSlug)}/accept-invite?token=${encodeURIComponent(token)}&tenant=${encodeURIComponent(tenantSlug)}`;

  const inviterLine = inviterEmail
    ? `<p style="color: #8b949e; font-size: 14px;"><strong>${inviterEmail}</strong> invited you to join <strong>${tenantName}</strong> on codeprism.</p>`
    : `<p style="color: #8b949e; font-size: 14px;">You've been invited to join <strong>${tenantName}</strong> on codeprism.</p>`;

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 0;">
      <h2 style="color: #e1e4e8; font-size: 20px;">Join ${tenantName} on codeprism</h2>
      ${inviterLine}
      <p style="color: #8b949e; font-size: 14px;">
        codeprism gives your AI coding tools deep context about your codebase — 90% fewer tokens, better answers.
      </p>
      <a href="${link}" style="display: inline-block; background: #58a6ff; color: #0d1117; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px; margin: 16px 0;">
        Accept Invitation
      </a>
      <p style="color: #484f58; font-size: 12px; margin-top: 24px;">
        This link expires in 15 minutes.
      </p>
      ${EMAIL_FOOTER}
    </div>
  `;

  await sendEmail(email, `Join ${tenantName} on codeprism`, html);
}

export async function sendForgotWorkspaceEmail(
  email: string,
  workspaces: Array<{ slug: string; name: string }>,
): Promise<void> {
  const workspaceRows = workspaces
    .map((w) => {
      const url = getTenantBaseUrl(w.slug);
      return `
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #21262d;">
            <strong style="color: #e1e4e8;">${w.name}</strong><br/>
            <a href="${url}/login" style="color: #58a6ff; font-size: 13px; text-decoration: none;">${url.replace(`${protocol}://`, "")}</a>
          </td>
        </tr>`;
    })
    .join("");

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 0;">
      <h2 style="color: #e1e4e8; font-size: 20px;">Your codeprism workspaces</h2>
      <p style="color: #8b949e; font-size: 14px;">
        Here are the codeprism workspaces associated with <strong>${email}</strong>:
      </p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        ${workspaceRows}
      </table>
      <p style="color: #484f58; font-size: 12px; margin-top: 24px;">
        Click any workspace URL to sign in. If you don't recognise these workspaces, you can safely ignore this email.
      </p>
      ${EMAIL_FOOTER}
    </div>
  `;

  await sendEmail(email, "Your codeprism workspaces", html);
}

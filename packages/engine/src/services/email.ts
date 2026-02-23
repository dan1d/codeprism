const RESEND_API_KEY = process.env["SRCMAP_RESEND_API_KEY"];
const SRCMAP_DOMAIN = process.env["SRCMAP_DOMAIN"] ?? "localhost:4000";
const FROM_EMAIL = process.env["SRCMAP_FROM_EMAIL"] ?? "srcmap <noreply@srcmap.ai>";

function getBaseUrl(): string {
  const protocol = SRCMAP_DOMAIN.includes("localhost") ? "http" : "https";
  return `${protocol}://${SRCMAP_DOMAIN}`;
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
  const link = `${getBaseUrl()}/auth/verify?token=${encodeURIComponent(token)}&tenant=${encodeURIComponent(tenantSlug)}`;

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 0;">
      <h2 style="color: #e1e4e8; font-size: 20px;">Sign in to srcmap</h2>
      <p style="color: #8b949e; font-size: 14px;">
        Click the button below to sign in to <strong>${tenantName}</strong> on srcmap.
      </p>
      <a href="${link}" style="display: inline-block; background: #58a6ff; color: #0d1117; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px; margin: 16px 0;">
        Sign in to srcmap
      </a>
      <p style="color: #484f58; font-size: 12px; margin-top: 24px;">
        This link expires in 15 minutes. If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  `;

  await sendEmail(email, `Sign in to ${tenantName} on srcmap`, html);
}

export async function sendInvitationEmail(
  email: string,
  token: string,
  tenantSlug: string,
  tenantName: string,
  inviterEmail?: string,
): Promise<void> {
  const link = `${getBaseUrl()}/accept-invite?token=${encodeURIComponent(token)}&tenant=${encodeURIComponent(tenantSlug)}`;

  const inviterLine = inviterEmail
    ? `<p style="color: #8b949e; font-size: 14px;"><strong>${inviterEmail}</strong> invited you to join <strong>${tenantName}</strong> on srcmap.</p>`
    : `<p style="color: #8b949e; font-size: 14px;">You've been invited to join <strong>${tenantName}</strong> on srcmap.</p>`;

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 0;">
      <h2 style="color: #e1e4e8; font-size: 20px;">Join ${tenantName} on srcmap</h2>
      ${inviterLine}
      <p style="color: #8b949e; font-size: 14px;">
        srcmap gives your AI coding tools deep context about your codebase, saving tokens and improving accuracy.
      </p>
      <a href="${link}" style="display: inline-block; background: #58a6ff; color: #0d1117; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px; margin: 16px 0;">
        Accept Invitation
      </a>
      <p style="color: #484f58; font-size: 12px; margin-top: 24px;">
        This link expires in 15 minutes.
      </p>
    </div>
  `;

  await sendEmail(email, `Join ${tenantName} on srcmap`, html);
}

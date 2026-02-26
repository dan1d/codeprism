# Teams and User Management

This guide covers how srcmap Cloud handles team workspaces, developer identification, and seat management.

## Creating a workspace

Visit [codeprism.dev/onboard](https://codeprism.dev/onboard) and follow the 4-step wizard:

1. **Create workspace** -- Enter your team/company name and your admin email
2. **API key** -- Copy the API key (shown once) and the generated MCP config
3. **Invite your team** -- Enter developer email addresses (optional, can be done later)
4. **Done** -- Link to your dashboard

The admin who creates the workspace is automatically registered as the first team member with the `admin` role.

### Founding teams

The first 100 teams to create a workspace get the **founding** plan: up to 10 developers free. After 100 teams, new workspaces get the **free** plan with 3 active developer seats.

## Inviting developers

Admins can invite developers from:

- The **onboarding wizard** (step 3)
- The **Team page** in the dashboard (`/dashboard/team`)

Enter email addresses (one per line or comma-separated). Each developer receives an email with:

- A magic link to accept the invitation
- Setup instructions for their AI tool

### What happens when a developer accepts

1. They click the magic link in their email
2. They land on the accept page, which shows their personalized MCP config
3. They copy the config into their AI tool (Cursor, Claude Code, Windsurf)
4. Their status changes from "invited" to "active" in the Team dashboard

## Developer identification via X-Dev-Email

In srcmap Cloud, developers are identified by the `X-Dev-Email` header in their MCP config:

```json
{
  "mcpServers": {
    "codeprism": {
      "url": "https://codeprism.dev/acme-corp/mcp/sse",
      "headers": {
        "Authorization": "Bearer sk_...",
        "X-Dev-Email": "alice@acme.com"
      }
    }
  }
}
```

This header feeds into the `dev_id` column in the metrics table, enabling:

- **Per-developer query stats** in the Team dashboard
- **Active seat counting** for billing
- **Auto-detection** of new developers

### Auto-detection

If a developer uses the team's API key with a new `X-Dev-Email` that hasn't been invited, srcmap automatically registers them as a "detected" member. The admin sees them in the Team page and can promote or deactivate them.

## Team member statuses

| Status | Meaning |
|--------|---------|
| **Active** | Accepted invitation, using srcmap |
| **Invited** | Invitation sent, not yet accepted |
| **Detected** | Auto-registered via X-Dev-Email (not formally invited) |
| **Deactivated** | Removed by admin (no longer counted as active) |

## Seat tracking

Seats are counted as the number of team members with status `active` or `detected`. The seat limit depends on the plan:

| Plan | Seat limit |
|------|-----------|
| Founding (first 100 teams) | 10 |
| Free | 3 active developers |
| Paid (coming soon) | Billed per active developer |

When the free plan limit is reached, new developers sending requests with unknown `X-Dev-Email` headers receive a 403 error. Existing members continue to work normally.

### How "10 devs, 6 accept" works

1. Admin creates a workspace and invites 10 email addresses
2. Each developer receives an email with a magic link
3. 6 developers click the link -- they're marked "active" and get their personalized MCP config
4. 4 developers ignore the invite -- they stay "invited" (no cost, don't count toward seats)
5. The Team dashboard shows: 6 active / 4 pending
6. Billing (when implemented) counts only the 6 active developers

## Dashboard authentication

The dashboard uses magic link authentication:

1. Go to `/login`
2. Enter your workspace slug and email
3. Check your email for a sign-in link
4. Click the link to create a session (valid for 30 days)

Sessions are tenant-scoped. Admins can see the Team page and invite/deactivate members. Regular members can view the dashboard but cannot manage the team.

## Self-hosted mode

In self-hosted mode (`CODEPRISM_MULTI_TENANT` not set or `false`), team features are disabled. The engine runs as a single-tenant instance without authentication. This is the default for `docker compose up -d`.

To enable multi-tenant features on a self-hosted instance, set:

```bash
CODEPRISM_MULTI_TENANT=true
CODEPRISM_ADMIN_KEY=your-admin-secret
CODEPRISM_DOMAIN=your-domain.com
```

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CODEPRISM_MULTI_TENANT` | Enable multi-tenancy | `false` |
| `CODEPRISM_ADMIN_KEY` | Secret for admin API routes | (none) |
| `CODEPRISM_DOMAIN` | Domain for email links | `localhost:4000` |
| `CODEPRISM_RESEND_API_KEY` | Resend API key for sending emails | (none, logs to console) |
| `CODEPRISM_FROM_EMAIL` | From address for emails | `srcmap <noreply@codeprism.dev>` |

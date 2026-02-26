/**
 * Extracts the tenant slug from the current hostname if running on a subdomain.
 *
 * Production:  gobiobridge.codeprism.dev  →  "gobiobridge"
 * Dev / bare:  codeprism.dev / localhost  →  null
 */
export function getSubdomainTenant(): string | null {
  if (typeof window === "undefined") return null;

  const host = window.location.hostname; // e.g. "gobiobridge.codeprism.dev"
  const parts = host.split(".");

  // Subdomains have at least 3 parts: [slug, "codeprism", "dev"]
  // Localhost or bare codeprism.dev → no tenant in the hostname
  if (parts.length < 3) return null;

  const slug = parts[0];
  // Guard against www / mail / etc.
  if (!slug || slug === "www" || slug === "mail" || slug === "app") return null;

  return slug;
}

/** True when the browser is on a tenant-specific subdomain. */
export function isOnSubdomain(): boolean {
  return getSubdomainTenant() !== null;
}

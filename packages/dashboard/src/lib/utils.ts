import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function stackColor(stack: string): string {
  const lower = stack.toLowerCase();
  if (lower.includes("rails") || lower.includes("sinatra") || lower.includes("ruby")) return "text-red-400 bg-red-900/30 border-red-800/50";
  if (lower.includes("react")) return "text-blue-400 bg-blue-900/30 border-blue-800/50";
  if (lower.includes("vue")) return "text-emerald-400 bg-emerald-900/30 border-emerald-800/50";
  if (lower.includes("next")) return "text-gray-300 bg-gray-800/50 border-gray-700/50";
  if (lower.includes("svelte")) return "text-orange-400 bg-orange-900/30 border-orange-800/50";
  if (lower.includes("angular")) return "text-red-500 bg-red-900/20 border-red-800/40";
  if (lower.includes("nestjs") || lower.includes("nest")) return "text-red-300 bg-red-900/20 border-red-800/30";
  // Python/Django checked BEFORE Go — "django" contains the substring "go"
  if (lower.includes("python") || lower.includes("fastapi") || lower.includes("django")) return "text-yellow-400 bg-yellow-900/30 border-yellow-800/50";
  if (lower === "go" || lower.includes("gin")) return "text-cyan-400 bg-cyan-900/30 border-cyan-800/50";
  if (lower.includes("laravel") || lower.includes("symfony") || lower.includes("php")) return "text-purple-400 bg-purple-900/30 border-purple-800/50";
  if (lower.includes("express")) return "text-lime-400 bg-lime-900/30 border-lime-800/50";
  if (lower.includes("fastify")) return "text-blue-300 bg-blue-900/20 border-blue-800/40";
  if (lower.includes("typescript") || lower.includes("node")) return "text-blue-300 bg-blue-900/20 border-blue-800/40";
  if (lower.includes("spring") || lower.includes("java")) return "text-green-400 bg-green-900/30 border-green-800/50";
  if (lower.includes("lambda")) return "text-orange-400 bg-orange-900/30 border-orange-800/50";
  return "text-gray-400 bg-gray-800/30 border-gray-700/50";
}

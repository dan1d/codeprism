import { BrowserRouter, Routes, Route, Outlet, useLocation, Navigate, useParams } from "react-router-dom";
import { Toaster } from "sonner";
import { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { Overview } from "@/pages/Overview";
import { Repositories } from "@/pages/Repositories";
import { KnowledgeBase } from "@/pages/KnowledgeBase";
import { Rules } from "@/pages/Rules";
import { Analytics } from "@/pages/Analytics";
import { SettingsPage } from "@/pages/Settings";
import { Landing } from "@/pages/Landing";
import { PublicStats } from "@/pages/PublicStats";
import { Onboard } from "@/pages/Onboard";
import { Login } from "@/pages/Login";
import { AcceptInvite } from "@/pages/AcceptInvite";
import { Team } from "@/pages/Team";
import { Benchmarks, BenchmarkDetail } from "@/pages/Benchmarks";
import { Terms } from "@/pages/Terms";
import { ForgotWorkspace } from "@/pages/ForgotWorkspace";
import { AuthProvider } from "@/contexts/AuthContext";
import { api, type InstanceInfo } from "@/lib/api";

function DashboardLayout() {
  const [instanceInfo, setInstanceInfo] = useState<InstanceInfo | null>(null);
  const location = useLocation();

  useEffect(() => {
    api.instanceInfo().then(setInstanceInfo).catch(() => {});
  }, [location.pathname]);

  const companyName = instanceInfo?.companyName ?? "";

  return (
    <ProtectedRoute>
      <div className="flex min-h-screen bg-background">
        <Sidebar companyName={companyName} />
        <main className="ml-[220px] flex-1 min-w-0 p-6">
          <Outlet context={{ instanceInfo, setInstanceInfo }} />
        </main>
      </div>
    </ProtectedRoute>
  );
}

function DashboardRoutes() {
  return (
    <Routes>
      {/* Public pages */}
      <Route path="/" element={<Landing />} />
      <Route path="/stats" element={<PublicStats />} />
      <Route path="/onboard" element={<Onboard />} />
      <Route path="/benchmarks" element={<Benchmarks />} />
      <Route path="/benchmarks/:slug" element={<BenchmarkDetail />} />
      <Route path="/login" element={<Login />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route path="/auth/verify" element={<AcceptInvite />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/forgot-workspace" element={<ForgotWorkspace />} />

      {/* Protected dashboard pages — share one Layout via Outlet */}
      <Route path="/dashboard" element={<DashboardLayout />}>
        <Route index element={<Overview />} />
        <Route path="repos" element={<Repositories />} />
        <Route path="knowledge" element={<KnowledgeBase />} />
        <Route path="rules" element={<Rules />} />
        <Route path="team" element={<Team />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="settings" element={<SettingsOutlet />} />
      </Route>

      {/* Transitional: redirect old /:slug path-based URLs to subdomain login */}
      <Route path="/:slug" element={<SlugRedirect />} />

      {/* Catch-all → home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/** Reads instanceInfo from the outlet context for the Settings page. */
function SettingsOutlet() {
  const { instanceInfo, setInstanceInfo } = useOutletContext<{
    instanceInfo: InstanceInfo | null;
    setInstanceInfo: (info: InstanceInfo) => void;
  }>();
  return <SettingsPage instanceInfo={instanceInfo} onUpdate={setInstanceInfo} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <DashboardRoutes />
        <Toaster
          position="bottom-right"
          theme="dark"
          toastOptions={{
            style: {
              background: "#1c2333",
              border: "1px solid #30363d",
              color: "#e1e4e8",
            },
          }}
        />
      </AuthProvider>
    </BrowserRouter>
  );
}

// Local imports to keep the file self-contained
import { useOutletContext } from "react-router-dom";

/**
 * Transitional redirect for old path-based tenant URLs (e.g. codeprism.dev/acme-corp).
 * Sends users to the correct subdomain login page. Remove after 60 days.
 */
function SlugRedirect() {
  const { slug } = useParams<{ slug: string }>();
  if (slug && /^[a-z0-9-]+$/.test(slug)) {
    const host = window.location.hostname;
    const parts = host.split(".");
    // Only redirect if we're on the apex domain (not already on a subdomain)
    if (parts.length === 2) {
      window.location.href = `https://${slug}.${host}/login`;
      return null;
    }
  }
  return <Navigate to="/" replace />;
}

import { BrowserRouter, Routes, Route, Outlet, useLocation } from "react-router-dom";
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

// Local import to keep the file self-contained
import { useOutletContext } from "react-router-dom";

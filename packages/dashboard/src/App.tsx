import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
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
import { AuthProvider } from "@/contexts/AuthContext";
import { api, type InstanceInfo } from "@/lib/api";

function Layout({ children, companyName }: { children: React.ReactNode; companyName: string }) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar companyName={companyName} />
      <main className="ml-[220px] flex-1 min-w-0 p-6">{children}</main>
    </div>
  );
}

function DashboardRoutes() {
  const [instanceInfo, setInstanceInfo] = useState<InstanceInfo | null>(null);
  const location = useLocation();
  const isDashboard = location.pathname.startsWith("/dashboard");

  useEffect(() => {
    if (isDashboard) {
      api.instanceInfo().then(setInstanceInfo).catch(() => {});
    }
  }, [isDashboard]);

  const companyName = instanceInfo?.companyName ?? "";

  return (
    <Routes>
      {/* Public pages (no sidebar) */}
      <Route path="/" element={<Landing />} />
      <Route path="/stats" element={<PublicStats />} />
      <Route path="/onboard" element={<Onboard />} />
      <Route path="/login" element={<Login />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route path="/auth/verify" element={<AcceptInvite />} />

      {/* Dashboard pages (with sidebar) */}
      <Route path="/dashboard" element={<Layout companyName={companyName}><Overview /></Layout>} />
      <Route path="/dashboard/repos" element={<Layout companyName={companyName}><Repositories /></Layout>} />
      <Route path="/dashboard/knowledge" element={<Layout companyName={companyName}><KnowledgeBase /></Layout>} />
      <Route path="/dashboard/rules" element={<Layout companyName={companyName}><Rules /></Layout>} />
      <Route path="/dashboard/team" element={<Layout companyName={companyName}><Team /></Layout>} />
      <Route path="/dashboard/analytics" element={<Layout companyName={companyName}><Analytics /></Layout>} />
      <Route path="/dashboard/settings" element={<Layout companyName={companyName}><SettingsPage instanceInfo={instanceInfo} onUpdate={setInstanceInfo} /></Layout>} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <DashboardRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

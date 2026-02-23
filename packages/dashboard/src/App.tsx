import { BrowserRouter, Routes, Route } from "react-router-dom";
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
import { api, type InstanceInfo } from "@/lib/api";

function Layout({ children, companyName }: { children: React.ReactNode; companyName: string }) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar companyName={companyName} />
      <main className="ml-[220px] flex-1 min-w-0 p-6">{children}</main>
    </div>
  );
}

export default function App() {
  const [instanceInfo, setInstanceInfo] = useState<InstanceInfo | null>(null);

  useEffect(() => {
    api.instanceInfo().then(setInstanceInfo).catch(() => {});
  }, []);

  const companyName = instanceInfo?.companyName ?? "";

  return (
    <BrowserRouter>
      <Routes>
        {/* Public pages (no sidebar) */}
        <Route path="/" element={<Landing />} />
        <Route path="/stats" element={<PublicStats />} />
        <Route path="/onboard" element={<Onboard />} />

        {/* Dashboard pages (with sidebar) */}
        <Route path="/dashboard" element={<Layout companyName={companyName}><Overview /></Layout>} />
        <Route path="/dashboard/repos" element={<Layout companyName={companyName}><Repositories /></Layout>} />
        <Route path="/dashboard/knowledge" element={<Layout companyName={companyName}><KnowledgeBase /></Layout>} />
        <Route path="/dashboard/rules" element={<Layout companyName={companyName}><Rules /></Layout>} />
        <Route path="/dashboard/analytics" element={<Layout companyName={companyName}><Analytics /></Layout>} />
        <Route path="/dashboard/settings" element={<Layout companyName={companyName}><SettingsPage instanceInfo={instanceInfo} onUpdate={setInstanceInfo} /></Layout>} />
      </Routes>
    </BrowserRouter>
  );
}

import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Overview } from "@/pages/Overview";
import { Repositories } from "@/pages/Repositories";
import { KnowledgeBase } from "@/pages/KnowledgeBase";
import { Analytics } from "@/pages/Analytics";
import { SettingsPage } from "@/pages/Settings";
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
      <Layout companyName={companyName}>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/repos" element={<Repositories />} />
          <Route path="/knowledge" element={<KnowledgeBase />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/settings" element={<SettingsPage instanceInfo={instanceInfo} onUpdate={setInstanceInfo} />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

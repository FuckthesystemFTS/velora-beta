import { AppNav } from "@/components/layout/app-nav";
import { BrandPanel, SiteShell } from "@/components/layout/site-shell";
import { InstallPanel } from "@/components/pwa/install-panel";

export default function InstallAppPage() {
  return (
    <SiteShell
      sidebar={
        <>
          <BrandPanel />
          <AppNav />
        </>
      }
    >
      <InstallPanel />
    </SiteShell>
  );
}

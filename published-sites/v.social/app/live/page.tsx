import { LiveStudio } from "@/components/live/live-studio";
import { AppNav } from "@/components/layout/app-nav";
import { BrandPanel, SiteShell } from "@/components/layout/site-shell";
import { requireUser } from "@/lib/auth";
import { getLiveHub } from "@/server/services/live-service";

export default async function LivePage() {
  const user = await requireUser();
  const hub = await getLiveHub(user.id);

  return (
    <SiteShell
      sidebar={
        <>
          <BrandPanel />
          <AppNav />
        </>
      }
    >
      <LiveStudio
        viewerUsername={user.username}
        initialActive={hub.active}
        initialArchive={hub.archive}
        initialOwnActive={hub.ownActive}
      />
    </SiteShell>
  );
}

import { AmazonConnectionForm } from "@/components/settings/amazon-connection-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const connection = await prisma.amazonConnection.findFirst({
    orderBy: {
      createdAt: "desc",
    },
  });

  return (
    <section className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Connect your seller account and configure SP-API credentials.
        </p>
      </div>

      <AmazonConnectionForm
        initialConnection={
          connection
            ? {
                sellerId: connection.sellerId,
                marketplaceId: connection.marketplaceId,
                lwaClientId: connection.lwaClientId,
                hasRefreshToken: Boolean(connection.refreshTokenEncrypted),
              }
            : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Environment Variables</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>`SP_API_CLIENT_ID` and `SP_API_CLIENT_SECRET` are required for sync.</p>
          <p>`SP_API_REFRESH_TOKEN` is optional when connection token is saved in DB.</p>
          <p>`SP_API_SELLER_ID`, `SP_API_MARKETPLACE_ID`, `SP_API_REGION` are supported.</p>
          <p>`SP_API_AWS_ACCESS_KEY`, `SP_API_AWS_SECRET_KEY`, and `SP_API_ROLE_ARN` are accepted for future extensions.</p>
          <p>`DATABASE_URL` should point to your local Prisma database file.</p>
        </CardContent>
      </Card>
    </section>
  );
}

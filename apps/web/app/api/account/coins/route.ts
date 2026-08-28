import { headers } from "next/headers";
import { getAvailableCoins } from "../../../../lib/account-service";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestHeaders = await headers();
  const coins = await getAvailableCoins(requestHeaders).catch(() => null);
  return Response.json({ coins });
}

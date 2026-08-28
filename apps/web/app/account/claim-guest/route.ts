import { NextResponse } from "next/server";
import { claimGuestSeat } from "../../../lib/account-service";
import { GUEST_COOKIE_NAME, readGuestSessionValue } from "../../../lib/guest-session";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const raw = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${GUEST_COOKIE_NAME}=`))?.slice(GUEST_COOKIE_NAME.length + 1);
  const secret = process.env.CHRONICA_SESSION_SECRET?.trim();
  const guest = raw && secret ? readGuestSessionValue(decodeURIComponent(raw), secret, new Date()) : null;
  let destination = new URL("/account", request.url);
  if (guest !== null) {
    const result = await claimGuestSeat(request.headers, guest);
    if (result === "attached" || result === "already_joined") destination = new URL(`/games/${encodeURIComponent(guest.gameId)}`, request.url);
  }
  const response = NextResponse.redirect(destination);
  response.cookies.delete(GUEST_COOKIE_NAME);
  return response;
}

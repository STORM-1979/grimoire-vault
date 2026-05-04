import { NextResponse } from "next/server";
import { issueLinkCode, getSessionForUser, unlinkSession } from "@/lib/data/telegram";
import { requireUser, withErrorHandler } from "@/lib/api-helpers";

/** GET — current session info */
export const GET = withErrorHandler(async () => {
  const user = await requireUser();
  const session = await getSessionForUser(user.id);
  if (!session) {
    return NextResponse.json({ linked: false });
  }
  // Hide the placeholder negative chat_id from the user
  const isPlaceholder = session.telegramChatId < 0;
  return NextResponse.json({
    linked: !isPlaceholder,
    pendingCode: session.linkCode,
    linkCodeExpires: session.linkCodeExpires,
    chatId: isPlaceholder ? null : session.telegramChatId,
  });
});

/** POST — issue a fresh 10-min link code */
export const POST = withErrorHandler(async () => {
  const user = await requireUser();
  const issued = await issueLinkCode(user.id);
  return NextResponse.json({
    code: issued.code,
    expiresAt: issued.expiresAt,
    botUsername: "TheBaseofKnowladge_bot",
  });
});

/** DELETE — disconnect chat */
export const DELETE = withErrorHandler(async () => {
  const user = await requireUser();
  await unlinkSession(user.id);
  return new NextResponse(null, { status: 204 });
});

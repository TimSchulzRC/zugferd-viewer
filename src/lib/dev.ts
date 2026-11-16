/**
 * In `next dev` every login and share code is 000000 and the forms fill it in, so local testing
 * needs no mailbox. `next build` sets NODE_ENV to production, so this is null in every deployment.
 */
export const DEV_CODE = process.env.NODE_ENV === "development" ? "000000" : null;

/** The server also needs mail to be off: a dev server that sends real mails gets real codes. */
export function devCode(mailToken: string | undefined) {
  return mailToken ? null : DEV_CODE;
}

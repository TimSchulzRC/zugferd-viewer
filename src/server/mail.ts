import { Lettermint } from "lettermint";
import { env } from "./env";

type Mail = { to: string; subject: string; heading: string; body: string; code?: string; link?: { label: string; url: string } };

function escape(text: string) {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function html({ heading, body, code, link }: Mail) {
  return `<!doctype html><html lang="de"><body style="margin:0;padding:32px 16px;background:#f5f5f5;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#171717">
<div style="max-width:440px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
<h1 style="margin:0 0 12px;font-size:20px">${escape(heading)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5">${escape(body)}</p>
${code ? `<p style="margin:0 0 20px;font-size:32px;font-weight:600;letter-spacing:6px;font-family:ui-monospace,monospace">${escape(code)}</p>` : ""}
${link ? `<a href="${escape(link.url)}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;border-radius:8px;padding:10px 18px;font-size:15px">${escape(link.label)}</a>` : ""}
</div></body></html>`;
}

async function send(mail: Mail) {
  const { LETTERMINT_TOKEN, MAIL_FROM } = env();
  const text = [mail.heading, "", mail.body, mail.code, mail.link?.url].filter((line) => line !== undefined).join("\n");
  if (!LETTERMINT_TOKEN) {
    console.log(`[mail, not sent: LETTERMINT_TOKEN is unset]\nTo: ${mail.to}\nSubject: ${mail.subject}\n${text}\n`);
    return;
  }
  await new Lettermint({ sendingToken: LETTERMINT_TOKEN }).emails.send({ from: MAIL_FROM, to: [mail.to], subject: mail.subject, html: html(mail), text });
}

export function sendLoginCode(to: string, code: string) {
  return send({
    to,
    subject: `${code} ist dein Anmeldecode`,
    heading: "Dein Anmeldecode",
    body: "Gib diesen Code im ZUGFeRD Viewer ein. Er gilt 10 Minuten.",
    code,
  });
}

export function sendInvitation(to: string, inviter: string) {
  const url = `${env().APP_URL}/login?email=${encodeURIComponent(to)}`;
  return send({
    to,
    subject: "Einladung zum ZUGFeRD Viewer",
    heading: "Du bist eingeladen",
    body: `${inviter} hat dich zum ZUGFeRD Viewer eingeladen. Melde dich mit dieser E-Mail-Adresse an.`,
    link: { label: "Anmelden", url },
  });
}

// Envoi sur chaque canal (BF-19). Un canal sans configuration est « absent » :
// l'alerte n'est ni envoyée ni enregistrée, elle partira quand il le sera.
// Prestataires au choix (points ouverts) : EMAIL_PROVIDER = resend | brevo,
// SMS_PROVIDER = orange | twilio.
import webpush from "npm:web-push@3.6.7";
import type { Channel } from "./reglages.ts";
import { env } from "./serveur.ts";

export interface Recipient {
  email: string | null;
  /** 10 chiffres, sans indicatif. */
  phone: string | null;
  push: { id: string; endpoint: string; p256dh: string; auth: string }[];
}

export interface Message {
  title: string;
  body: string;
  /** Lien ouvert depuis la notification ou l'email. */
  url: string;
  tag: string;
}

export interface SendResult {
  ok: boolean;
  error?: string;
  /** Abonnements push expirés, à supprimer. */
  gonePush?: string[];
}

const APP_URL = () => env("APP_URL") ?? "http://localhost:5173";

export function configuredChannels(): Channel[] {
  const out: Channel[] = [];
  if (env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY")) out.push("push");
  if (env("EMAIL_API_KEY") && env("EMAIL_FROM")) out.push("email");
  if (env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID")) out.push("whatsapp");
  const sms = env("SMS_PROVIDER");
  if (sms === "orange" && env("ORANGE_CLIENT_ID") && env("ORANGE_CLIENT_SECRET") && env("ORANGE_SENDER")) out.push("sms");
  if (sms === "twilio" && env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && (env("TWILIO_FROM") || env("TWILIO_MESSAGING_SERVICE_SID"))) out.push("sms");
  return out;
}

export async function send(channel: Channel, to: Recipient, msg: Message): Promise<SendResult> {
  try {
    switch (channel) {
      case "push":
        return await sendPush(to, msg);
      case "email":
        return await sendEmail(to, msg);
      case "whatsapp":
        return await sendWhatsApp(to, msg);
      case "sms":
        return await sendSms(to, msg);
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------- push
let vapidReady = false;

async function sendPush(to: Recipient, msg: Message): Promise<SendResult> {
  if (to.push.length === 0) return { ok: false, error: "aucun appareil abonné" };
  if (!vapidReady) {
    webpush.setVapidDetails(env("VAPID_SUBJECT") ?? "mailto:contact@previenergie.ci", env("VAPID_PUBLIC_KEY")!, env("VAPID_PRIVATE_KEY")!);
    vapidReady = true;
  }
  const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url, tag: msg.tag });
  const gone: string[] = [];
  let delivered = 0;
  let lastError = "";
  for (const sub of to.push) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
        TTL: 6 * 3600,
        urgency: "high",
      });
      delivered++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) gone.push(sub.id);
      lastError = `push ${status ?? ""} ${(e as Error).message}`.trim();
    }
  }
  return delivered > 0 ? { ok: true, gonePush: gone } : { ok: false, error: lastError || "échec push", gonePush: gone };
}

// ---------------------------------------------------------------- email
function emailHtml(msg: Message): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#fff7ed;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="100%" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#ea580c;color:#ffffff;padding:18px 24px;font-size:20px;font-weight:bold">PréviÉnergie</td></tr>
<tr><td style="padding:24px;color:#1c1917;font-size:16px;line-height:1.5">
<p style="margin:0 0 8px;font-weight:bold">${esc(msg.title)}</p><p style="margin:0 0 20px">${esc(msg.body)}</p>
<a href="${esc(msg.url)}" style="display:inline-block;background:#ea580c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold">Ouvrir PréviÉnergie</a>
</td></tr>
<tr><td style="padding:16px 24px;color:#78716c;font-size:12px;border-top:1px solid #f5f5f4">
Service indépendant, non affilié à la CIE. Tu peux régler tes alertes dans l'application.</td></tr>
</table></td></tr></table></body></html>`;
}

async function sendEmail(to: Recipient, msg: Message): Promise<SendResult> {
  if (!to.email) return { ok: false, error: "pas d'adresse email" };
  const provider = env("EMAIL_PROVIDER") ?? "resend";
  const from = env("EMAIL_FROM")!;
  const subject = `PréviÉnergie : ${msg.title}`;
  const text = `${msg.body}\n\n${msg.url}\n\nService indépendant, non affilié à la CIE.`;
  let res: Response;
  if (provider === "brevo") {
    res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env("EMAIL_API_KEY")!, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: from, name: "PréviÉnergie" },
        to: [{ email: to.email }],
        subject,
        htmlContent: emailHtml(msg),
        textContent: text,
      }),
    });
  } else {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env("EMAIL_API_KEY")}`, "content-type": "application/json" },
      body: JSON.stringify({ from: `PréviÉnergie <${from}>`, to: [to.email], subject, html: emailHtml(msg), text }),
    });
  }
  return res.ok ? { ok: true } : { ok: false, error: `email ${res.status} ${(await res.text()).slice(0, 200)}` };
}

// ---------------------------------------------------------------- WhatsApp (Meta Cloud API)
async function sendWhatsApp(to: Recipient, msg: Message): Promise<SendResult> {
  if (!to.phone) return { ok: false, error: "pas de numéro" };
  const version = env("WHATSAPP_API_VERSION") ?? "v21.0";
  const res = await fetch(`https://graph.facebook.com/${version}/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: `225${to.phone}`,
      type: "template",
      // Modèle à faire valider par Meta : un paramètre {{1}} pour le texte de l'alerte.
      template: {
        name: env("WHATSAPP_TEMPLATE") ?? "previenergie_alerte",
        language: { code: env("WHATSAPP_TEMPLATE_LANG") ?? "fr" },
        components: [{ type: "body", parameters: [{ type: "text", text: msg.body.slice(0, 1000) }] }],
      },
    }),
  });
  return res.ok ? { ok: true } : { ok: false, error: `whatsapp ${res.status} ${(await res.text()).slice(0, 200)}` };
}

// ---------------------------------------------------------------- SMS
let orangeToken: { value: string; until: number } | null = null;

async function orangeAccessToken(): Promise<string> {
  if (orangeToken && orangeToken.until > Date.now() + 60_000) return orangeToken.value;
  const basic = btoa(`${env("ORANGE_CLIENT_ID")}:${env("ORANGE_CLIENT_SECRET")}`);
  const res = await fetch("https://api.orange.com/oauth/v3/token", {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`orange oauth ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  orangeToken = { value: data.access_token, until: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function sendSms(to: Recipient, msg: Message): Promise<SendResult> {
  if (!to.phone) return { ok: false, error: "pas de numéro" };
  // Un SMS = 160 caractères : on n'envoie que le texte, sans lien.
  const text = `PreviEnergie: ${msg.body}`.slice(0, 300);
  if (env("SMS_PROVIDER") === "twilio") {
    const sid = env("TWILIO_ACCOUNT_SID")!;
    const form = new URLSearchParams({ To: `+225${to.phone}`, Body: text });
    const service = env("TWILIO_MESSAGING_SERVICE_SID");
    if (service) form.set("MessagingServiceSid", service);
    else form.set("From", env("TWILIO_FROM")!);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { authorization: `Basic ${btoa(`${sid}:${env("TWILIO_AUTH_TOKEN")}`)}`, "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
    return res.ok ? { ok: true } : { ok: false, error: `twilio ${res.status} ${(await res.text()).slice(0, 200)}` };
  }
  const sender = `tel:+225${env("ORANGE_SENDER")}`;
  const res = await fetch(`https://api.orange.com/smsmessaging/v1/outbound/${encodeURIComponent(sender)}/requests`, {
    method: "POST",
    headers: { authorization: `Bearer ${await orangeAccessToken()}`, "content-type": "application/json" },
    body: JSON.stringify({
      outboundSMSMessageRequest: {
        address: `tel:+225${to.phone}`,
        senderAddress: sender,
        ...(env("ORANGE_SENDER_NAME") ? { senderName: env("ORANGE_SENDER_NAME") } : {}),
        outboundSMSTextMessage: { message: text },
      },
    }),
  });
  return res.ok ? { ok: true } : { ok: false, error: `orange sms ${res.status} ${(await res.text()).slice(0, 200)}` };
}

export function appLink(path = "/"): string {
  return new URL(path, APP_URL()).toString();
}

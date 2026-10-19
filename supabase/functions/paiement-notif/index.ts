// Notification serveur de CinetPay (notify_url). Le contenu reçu n'est pas
// cru : seul l'identifiant de transaction sert, et le statut est revérifié.
import { verifyAndApply } from "../_shared/cinetpay.ts";
import { adminClient, env } from "../_shared/serveur.ts";

Deno.serve(async (req) => {
  // CinetPay teste la disponibilité de l'URL par un GET.
  if (req.method !== "POST") return new Response("ok");
  try {
    const type = req.headers.get("content-type") ?? "";
    let transactionId = "";
    let siteId = "";
    if (type.includes("application/json")) {
      const body = await req.json();
      transactionId = String(body.cpm_trans_id ?? "");
      siteId = String(body.cpm_site_id ?? "");
    } else {
      const form = await req.formData();
      transactionId = String(form.get("cpm_trans_id") ?? "");
      siteId = String(form.get("cpm_site_id") ?? "");
    }
    if (!transactionId || (env("CINETPAY_SITE_ID") && siteId && siteId !== env("CINETPAY_SITE_ID"))) {
      return new Response("ignoré", { status: 200 });
    }
    const result = await verifyAndApply(adminClient(), transactionId);
    return new Response(JSON.stringify({ status: result.status }), { headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error(e);
    // 500 : CinetPay renverra la notification plus tard.
    return new Response("erreur", { status: 500 });
  }
});

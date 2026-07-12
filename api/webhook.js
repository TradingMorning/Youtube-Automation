// /api/webhook.js
// Razorpay calls this URL when a payment succeeds.
// Set this as the webhook URL in Razorpay Dashboard -> Settings -> Webhooks:
//   https://fondpeace.com/api/webhook
// Subscribe to event: payment_link.paid  (or payment.captured if using plain Payment Links)
//
// Env vars needed in Vercel -> Settings -> Environment Variables:
//   RAZORPAY_WEBHOOK_SECRET   (set when you create the webhook in Razorpay)
//   RESEND_API_KEY            (from resend.com, free tier)
//   KV_REST_API_URL / KV_REST_API_TOKEN   (auto-added when you attach Vercel KV)
//   DOWNLOAD_URL               (e.g. your GitHub Release .exe link)

import crypto from "crypto";
import { kv } from "@vercel/kv";

export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function generateLicenseKey() {
  // Format: SS-XXXX-XXXX-XXXX  (Shorts Studio)
  const part = () => crypto.randomBytes(2).toString("hex").toUpperCase();
  return `SS-${part()}-${part()}-${part()}`;
}

async function sendLicenseEmail(toEmail, licenseKey) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Shorts Studio <orders@fondpeace.com>",
      to: toEmail,
      subject: "Your Shorts Studio license key",
      html: `
        <p>Thanks for your purchase!</p>
        <p><b>Your license key:</b> ${licenseKey}</p>
        <p><a href="${process.env.DOWNLOAD_URL}">Download Shorts Studio</a></p>
        <p>Enter this key the first time you open the app. It activates on one device.</p>
      `,
    }),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const rawBody = await readRawBody(req);

  // Verify the webhook actually came from Razorpay
  const signature = req.headers["x-razorpay-signature"];
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  if (signature !== expected) {
    return res.status(400).json({ error: "Invalid signature" });
  }

  const event = JSON.parse(rawBody);

  if (event.event === "payment_link.paid" || event.event === "payment.captured") {
    const payload = event.payload.payment_link?.entity || event.payload.payment.entity;
    const email =
      payload.customer?.email || event.payload.payment?.entity?.email;
    const paymentId = payload.id;

    if (!email) {
      return res.status(400).json({ error: "No customer email on payment" });
    }

    // Avoid generating two keys if Razorpay retries the webhook
    const already = await kv.get(`payment:${paymentId}`);
    if (already) return res.status(200).json({ ok: true, dup: true });

    const licenseKey = generateLicenseKey();

    // Store the license: unused, no device bound yet
    await kv.set(`license:${licenseKey}`, {
      email,
      deviceId: null,
      status: "unused",
      createdAt: Date.now(),
    });
    await kv.set(`payment:${paymentId}`, licenseKey);

    await sendLicenseEmail(email, licenseKey);
  }

  return res.status(200).json({ ok: true });
}

// /api/activate.js
// The EXE calls this once, the first time someone enters their license key.
// POST body: { "licenseKey": "SS-XXXX-XXXX-XXXX", "deviceId": "<hardware fingerprint>" }
//
// Behaviour:
//   - key not found          -> 404 "Invalid license key"
//   - unused                 -> binds it to this deviceId, returns "activated"
//   - used, same deviceId    -> returns "activated" (reinstalling on the same PC is fine)
//   - used, different device -> 403 "Already activated on another device"

import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { licenseKey, deviceId } = req.body || {};
  if (!licenseKey || !deviceId) {
    return res.status(400).json({ error: "licenseKey and deviceId are required" });
  }

  const record = await kv.get(`license:${licenseKey}`);
  if (!record) {
    return res.status(404).json({ error: "Invalid license key" });
  }

  if (record.status === "unused") {
    record.status = "activated";
    record.deviceId = deviceId;
    record.activatedAt = Date.now();
    await kv.set(`license:${licenseKey}`, record);
    return res.status(200).json({ status: "activated" });
  }

  if (record.deviceId === deviceId) {
    return res.status(200).json({ status: "activated" });
  }

  return res.status(403).json({ error: "This license is already activated on another device" });
}

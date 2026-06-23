import { analyzeEsgReport, readBody } from "./_scope3.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    res.status(200).json(analyzeEsgReport(await readBody(req)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

import { loadFactors } from "./_scope3.js";

export default async function handler(req, res) {
  try {
    res.status(200).json(await loadFactors());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

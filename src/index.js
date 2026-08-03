import { httpServerHandler } from "cloudflare:node";
import express from "express";
import cors from "cors";

// We import the new Unified Brand-first priority logic
import { searchMedicine } from "./search/omniIndex.js";

const app = express();
app.use(cors());
app.use(express.json());

// Base Health Check
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "Wonne Brand+Composition API" });
});

// Helper function to catch both PowerShell and Oration AI parameter names
const extractQuery = (req) => {
  return req.body?.query || req.body?.spoken_medicine_name;
};

// ==========================================
// ROUTE 1: The Root POST (Fixes the URL that wasn't working)
// ==========================================
app.post("/", (req, res) => {
  const searchInput = extractQuery(req);
  if (!searchInput || typeof searchInput !== "string") {
    return res.status(400).json({ error: "A valid 'query' string is required." });
  }
  // Funnels directly into the new priority logic
  return res.json(searchMedicine(searchInput));
});

// ==========================================
// ROUTE 2: /medicine_lookup (Overrides the old logic!)
// ==========================================
app.post("/medicine_lookup", (req, res) => {
  const searchInput = extractQuery(req);
  if (!searchInput || typeof searchInput !== "string") {
    return res.status(400).json({ error: "A valid 'query' string is required." });
  }
  // CHANGED: Now forces the new priority logic instead of omniIndex
  return res.json(searchMedicine(searchInput));
});

// ==========================================
// ROUTE 3: /composition_lookup
// ==========================================
app.post("/composition_lookup", (req, res) => {
  const searchInput = extractQuery(req);
  if (!searchInput || typeof searchInput !== "string") {
    return res.status(400).json({ error: "A valid 'query' string is required." });
  }
  return res.json(searchMedicine(searchInput));
});

// Catch-all 404 Fallback
app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

const PORT = 8000;
app.listen(PORT);
export default httpServerHandler({ port: PORT });

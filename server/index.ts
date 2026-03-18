import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { getLivePortfolioData, getLiveDashboardData } from "./livePortfolio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.get("/api/live-portfolio", async (_req, res) => {
    try {
      const data = await getLivePortfolioData();
      res.json(data);
    } catch (error) {
      res.status(500).json({
        error: "Unable to load live portfolio snapshot",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/live-dashboard", async (_req, res) => {
    try {
      const data = await getLiveDashboardData();
      res.json(data);
    } catch (error) {
      res.status(500).json({
        error: "Unable to load live dashboard snapshot",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);

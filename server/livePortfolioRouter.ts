import { router, publicProcedure } from "./_core/trpc";
import { getLivePortfolioData, getLiveDashboardData } from "./livePortfolio";

export const livePortfolioRouter = router({
  getSnapshot: publicProcedure.query(async () => {
    return getLivePortfolioData();
  }),
  getDashboard: publicProcedure.query(async () => {
    return getLiveDashboardData();
  }),
});

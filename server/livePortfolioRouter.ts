import { router, publicProcedure } from "./_core/trpc";
import { getLivePortfolioData, getLiveDashboardData, getMsbSignals } from "./livePortfolio";

export const livePortfolioRouter = router({
  getSnapshot: publicProcedure.query(async () => {
    return getLivePortfolioData();
  }),
  getDashboard: publicProcedure.query(async () => {
    return getLiveDashboardData();
  }),
  getMsbSignals: publicProcedure.query(async () => {
    return getMsbSignals();
  }),
});

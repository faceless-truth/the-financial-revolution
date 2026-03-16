import { publicProcedure, router } from "./_core/trpc";
import { getLivePortfolioData } from "./livePortfolio";

export const livePortfolioRouter = router({
  getSnapshot: publicProcedure.query(async () => {
    return getLivePortfolioData();
  }),
});

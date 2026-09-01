import { Request, Response } from "express";
import { sendSuccess } from "../../common/apiResponse";
import { MarketIntelligenceService } from "./market-intelligence.service";
import { RecommendationBody, TrendQuery } from "./market-intelligence.schemas";
const day = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate()-n); return d; };
export function createMarketIntelligenceController(service: MarketIntelligenceService) { return {
  snapshot: async (req: Request,res:Response) => sendSuccess(res, await service.snapshot(req.params.cropId, req.query as any), "Market snapshot retrieved."),
  trends: async (req: Request,res:Response) => { const q=req.query as unknown as TrendQuery; const end=q.endDate ?? new Date(); const start=q.startDate ?? day(q.days ?? 30); return sendSuccess(res, await service.trends(req.params.cropId, { mandiId:q.mandiId,startDate:start,endDate:end }), "Market trends retrieved."); },
  nearby: async (req: Request,res:Response) => { const q=req.query as any; return sendSuccess(res, await service.nearby(q.cropId, { latitude:q.latitude, longitude:q.longitude }, q.radiusKm), "Nearby markets retrieved."); },
  compare: async (req: Request,res:Response) => { const q=req.query as any; return sendSuccess(res, await service.compare(req.params.cropId, { ...q, location:q.latitude === undefined ? undefined : { latitude:q.latitude,longitude:q.longitude } }), "Markets compared."); },
  recommend: async (req: Request,res:Response) => { const b=req.body as RecommendationBody; const quantityQtl = b.quantity === undefined ? undefined : b.unit === "KG" ? b.quantity/100 : b.unit === "TONNE" ? b.quantity*10 : b.quantity; return sendSuccess(res, await service.recommend(b.cropId,b.location,b.radiusKm,quantityQtl,req.user), "Market recommendations generated."); },
  overview: async (req: Request,res:Response) => sendSuccess(res, await service.mandiOverview(req.params.mandiId), "Mandi overview retrieved."),
  mandiCrop: async (req: Request,res:Response) => sendSuccess(res, await service.trends(req.params.cropId,{ mandiId:req.params.mandiId,startDate:day(30),endDate:new Date() }), "Mandi crop market data retrieved."),
  lotRecommend: async (req: Request,res:Response) => sendSuccess(res, await service.lotRecommendation(req.user!,req.params.lotPublicId,Number(req.query.radiusKm ?? 150)), "Lot market recommendations generated."),
}; }

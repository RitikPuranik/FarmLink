import { BuyerVerificationStatus, QualityGrade } from "@prisma/client";
import { haversineKm, round } from "../market-intelligence/analytics";
import { MATCH_WEIGHTS, MatchFactor } from "./buyer-matching.types";

export function qualityCompatible(lotGrade: QualityGrade | null | undefined, required: QualityGrade | null | undefined) { if (!required || !lotGrade) return null; const order: Record<string,number>={A:4,B:3,C:2,D:1,REJECTED:0}; return order[lotGrade] >= order[required]; }
export function scoreMatch(input:{quantityKg:number; minimumQuantityKg:number|null; requiredQuantityKg:number; lotGrade?:QualityGrade|null; grade?:QualityGrade|null; lotLat?:number|null; lotLon?:number|null; demandLat?:number|null; demandLon?:number|null; targetPrice?:number|null; offerablePrice?:number|null; deliveryCompatible?:boolean|null; verification:BuyerVerificationStatus}) {
  const factors: Partial<Record<MatchFactor,number>>={CROP:1,QUANTITY:Math.min(1,input.quantityKg / (input.minimumQuantityKg ?? input.requiredQuantityKg)),VERIFICATION:input.verification === "VERIFIED" ? 1 : 0};
  const quality=qualityCompatible(input.lotGrade,input.grade); if(quality!==null) factors.QUALITY=quality?1:0;
  let distanceKm:number|null=null; if(input.lotLat!=null&&input.lotLon!=null&&input.demandLat!=null&&input.demandLon!=null){distanceKm=haversineKm(input.lotLat,input.lotLon,input.demandLat,input.demandLon); factors.DISTANCE=Math.max(0,1-distanceKm/500);}
  if(input.targetPrice!=null&&input.offerablePrice!=null) factors.PRICE=input.offerablePrice>=input.targetPrice?1:Math.max(0,input.offerablePrice/input.targetPrice);
  if(input.deliveryCompatible!==null&&input.deliveryCompatible!==undefined) factors.DELIVERY_WINDOW=input.deliveryCompatible?1:0;
  const used=Object.keys(factors) as MatchFactor[], omitted=(Object.keys(MATCH_WEIGHTS) as MatchFactor[]).filter(x=>!used.includes(x)); const total=used.reduce((n,x)=>n+MATCH_WEIGHTS[x],0); const score=round(used.reduce((n,x)=>n+(factors[x]??0)*MATCH_WEIGHTS[x],0)/total*100); const confidence=round(used.length/Object.keys(MATCH_WEIGHTS).length*100);
  const reasons=["Matches your crop requirement and requested quantity."]; if(factors.VERIFICATION) reasons.push("Buyer is verified."); if(factors.QUALITY) reasons.push("Quality requirements are compatible."); if(distanceKm!==null) reasons.push("Distance was calculated from available locations."); const warnings:string[]=[]; if(!("PRICE" in factors))warnings.push("Buyer has not specified a target price."); if(!("QUALITY" in factors))warnings.push("Quality requirements are incomplete."); if(distanceKm===null)warnings.push("Distance could not be calculated."); return {matchScore:score,matchConfidence:confidence,distanceKm,factorsUsed:used,omittedFactors:omitted,reasons,warnings};
}

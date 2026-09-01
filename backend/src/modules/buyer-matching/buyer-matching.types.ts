export const MATCH_WEIGHTS = { CROP:.30, QUANTITY:.15, QUALITY:.15, DISTANCE:.10, PRICE:.10, DELIVERY_WINDOW:.10, VERIFICATION:.10 } as const;
export type MatchFactor = keyof typeof MATCH_WEIGHTS;
export const demandTransitions: Record<string,string[]> = { DRAFT:["ACTIVE","CANCELLED"], ACTIVE:["PAUSED","FULFILLED","CANCELLED","EXPIRED"], PAUSED:["ACTIVE","CANCELLED"] };
export const offerTransitions: Record<string,string[]> = { DRAFT:["SENT"], SENT:["COUNTERED","ACCEPTED","REJECTED","WITHDRAWN","EXPIRED"], COUNTERED:["COUNTERED","ACCEPTED","REJECTED","WITHDRAWN","EXPIRED"] };
export const requireTransition = (map:Record<string,string[]>, from:string, to:string, code:string) => { if (!map[from]?.includes(to)) { const e=new Error(code); (e as any).code=code; throw e; } };

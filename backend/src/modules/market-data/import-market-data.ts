import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { prisma } from "../../config/prisma";
import { MarketDataService, SourceMarketRecord } from "./market-data.service";
const file=process.argv[2]; if(!file) throw new Error("Usage: npm run market:import -- <file.csv|xlsx|json>");
function rows(): Record<string,unknown>[] { const ext=path.extname(file).toLowerCase(); if(ext===".json") return JSON.parse(fs.readFileSync(file,"utf8")); const sheet=XLSX.readFile(file).Sheets[XLSX.readFile(file).SheetNames[0]]; return XLSX.utils.sheet_to_json(sheet,{defval:""}); }
async function* records(): AsyncGenerator<SourceMarketRecord> { for(const r of rows()) yield {source:"historical-file",sourceRecordId:String(r.id || r.ID || "") || undefined,observedDate:new Date(String(r.arrival_date || r.date)),commodity:String(r.commodity || r.crop),marketId:String(r.market_id || r.market_code || "") || undefined,mandiName:String(r.market || r.mandi),state:String(r.state),district:String(r.district),minPrice:Number(r.min_price || r.minPrice),maxPrice:Number(r.max_price || r.maxPrice),modalPrice:Number(r.modal_price || r.modalPrice),priceUnit:String(r.price_unit || r.unit || "QTL"),arrivals:r.arrivals === "" || r.arrivals === undefined ? null : Number(r.arrivals)}; }
async function main(){await prisma.$connect(); const result=await new MarketDataService(prisma).run(records(),"historical-file","HISTORICAL_IMPORT"); console.log(JSON.stringify(result)); await prisma.$disconnect();} main().catch(async e=>{console.error(e);await prisma.$disconnect();process.exit(1);});

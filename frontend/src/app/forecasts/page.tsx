"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, RefreshCw } from "lucide-react";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader } from "@/components/ui/stat-card";
import { Card, Alert } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { LoadingBlock } from "@/components/StateBlocks";
import { useCropsQuery } from "@/hooks/useReferenceData";
import { forecastApi } from "@/services/marketApi";

function Content(){
 const crops=useCropsQuery(); const [cropId,setCropId]=React.useState(""); const [horizon,setHorizon]=React.useState("7"); const qc=useQueryClient();
 React.useEffect(()=>{if(crops.data?.length&&!cropId)setCropId(crops.data[0].id)},[crops.data,cropId]);
 const latest=useQuery({queryKey:["forecast",cropId],queryFn:()=>forecastApi.latestForCrop(cropId),enabled:!!cropId,retry:false});
 const generate=useMutation({mutationFn:()=>forecastApi.generate({cropId,scope:{type:"CROP_WIDE"},horizonDays:Number(horizon)}),onSuccess:()=>qc.invalidateQueries({queryKey:["forecast",cropId]})});
 return <div><PageHeader title="Price Forecast" description="Explainable, data-sufficiency-aware price forecasting from the backend forecasting engine." actions={<Button className="w-auto" isLoading={generate.isPending} disabled={!cropId} onClick={()=>generate.mutate()}><RefreshCw className="h-4 w-4"/> Generate / refresh</Button>}/>
 <Card className="mb-6"><div className="grid gap-4 sm:grid-cols-2"><div><label className="mb-1.5 block text-sm font-medium">Crop</label><Select value={cropId} onChange={e=>setCropId(e.target.value)}><option value="">Select crop</option>{(crops.data??[]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select></div><div><label className="mb-1.5 block text-sm font-medium">Forecast horizon</label><Select value={horizon} onChange={e=>setHorizon(e.target.value)}><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></Select></div></div>{generate.isError&&<Alert variant="error" className="mt-4">Forecast generation could not be completed.</Alert>}</Card>
 <Card><div className="mb-4 flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20"><BarChart3 className="h-5 w-5"/></span><div><h2 className="font-semibold">Latest crop-wide forecast</h2><p className="text-sm text-muted-foreground">The backend returns insufficient-data outcomes honestly instead of fabricating a prediction.</p></div></div>{latest.isLoading?<LoadingBlock/>:latest.isError?<p className="text-sm text-muted-foreground">No valid forecast exists yet. Generate one above.</p>:<pre className="max-h-[480px] overflow-auto rounded-2xl bg-[#242424] p-5 text-xs leading-5 text-[#f8f4e9]">{JSON.stringify(latest.data,null,2)}</pre>}</Card></div>
}
export default function ForecastsPage(){return <RoleProtectedPage role="FARMER"><Content/></RoleProtectedPage>}

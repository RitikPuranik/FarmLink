"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Plus } from "lucide-react";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader } from "@/components/ui/stat-card";
import { Card, Alert } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { LoadingBlock } from "@/components/StateBlocks";
import { useSelectedFpo } from "@/hooks/useSelectedFpo";
import { FpoPicker } from "@/components/fpo/FpoPicker";
import { useCropsQuery } from "@/hooks/useReferenceData";
import { fpoApi } from "@/services/fpoAdminApi";

function Content({fpoId}:{fpoId:string}){const crops=useCropsQuery(); const qc=useQueryClient(); const agg=useQuery({queryKey:["fpo","aggregation",fpoId],queryFn:()=>fpoApi.cropAggregation(fpoId)}); const analytics=useQuery({queryKey:["fpo","analytics",fpoId],queryFn:()=>fpoApi.analyticsOverview(fpoId)}); const groups=useQuery({queryKey:["fpo","groups",fpoId],queryFn:()=>fpoApi.listAggregationGroups(fpoId)}); const [cropId,setCropId]=React.useState(""); const [qty,setQty]=React.useState(""); const [date,setDate]=React.useState(""); const create=useMutation({mutationFn:()=>fpoApi.createAggregationGroup(fpoId,{cropId,targetQuantity:qty?Number(qty):undefined,unit:"QTL",targetDate:date||undefined}),onSuccess:()=>{setQty("");setDate("");qc.invalidateQueries({queryKey:["fpo","groups",fpoId]})}}); React.useEffect(()=>{if(crops.data?.length&&!cropId)setCropId(crops.data[0].id)},[crops.data,cropId]); return <div className="space-y-6"><div className="grid gap-6 lg:grid-cols-2"><Card><div className="mb-3 flex items-center gap-2"><BarChart3 className="h-5 w-5"/><h2 className="font-semibold">Crop aggregation</h2></div>{agg.isLoading?<LoadingBlock/>:<pre className="max-h-72 overflow-auto rounded-2xl bg-[#242424] p-4 text-xs text-[#f8f4e9]">{JSON.stringify(agg.data,null,2)}</pre>}</Card><Card><h2 className="mb-3 font-semibold">Analytics overview</h2>{analytics.isLoading?<LoadingBlock/>:<pre className="max-h-72 overflow-auto rounded-2xl bg-secondary p-4 text-xs">{JSON.stringify(analytics.data,null,2)}</pre>}</Card></div><Card><div className="mb-4 flex items-center gap-2"><Plus className="h-5 w-5"/><h2 className="font-semibold">Create aggregation target</h2></div><div className="grid gap-3 sm:grid-cols-3"><Select value={cropId} onChange={e=>setCropId(e.target.value)}>{(crops.data??[]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select><Input type="number" min="0" value={qty} onChange={e=>setQty(e.target.value)} placeholder="Target quantity (QTL)"/><Input type="date" value={date} onChange={e=>setDate(e.target.value)}/></div><Button className="mt-3 w-auto" disabled={!cropId||!qty} isLoading={create.isPending} onClick={()=>create.mutate()}>Create target</Button>{create.isError&&<Alert variant="error" className="mt-3">Could not create the aggregation target.</Alert>}</Card><Card><h2 className="mb-3 font-semibold">Aggregation targets</h2>{groups.isLoading?<LoadingBlock/>:<pre className="max-h-80 overflow-auto rounded-2xl bg-secondary p-4 text-xs">{JSON.stringify(groups.data,null,2)}</pre>}</Card></div>}
function Page(){const {fpoId,setFpoId,ready}=useSelectedFpo(); if(!ready)return null; return <div><PageHeader title="Crop Aggregation" description="Combine member supply estimates into visible targets and operational analytics."/>{fpoId?<Content fpoId={fpoId}/>:<FpoPicker onSelect={setFpoId}/>}</div>}
export default function FpoAggregationPage(){return <RoleProtectedPage role="FPO_ADMIN"><Page/></RoleProtectedPage>}

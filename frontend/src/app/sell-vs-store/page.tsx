"use client";
import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Scale, Sparkles } from "lucide-react";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader } from "@/components/ui/stat-card";
import { Card, Alert } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { LoadingBlock } from "@/components/StateBlocks";
import { lotApi } from "@/services/lotApi";
import { sellStoreApi } from "@/services/sellStoreApi";

function Content(){const lots=useQuery({queryKey:["lots","decision"],queryFn:()=>lotApi.listMine()}); const [id,setId]=React.useState(""); const decision=useMutation({mutationFn:()=>sellStoreApi.analyze(id)}); const history=useQuery({queryKey:["sell-store","history",id],queryFn:()=>sellStoreApi.history(id),enabled:!!id}); return <div><PageHeader title="Sell vs Store" description="Use the deterministic backend decision engine to compare selling now with storing the lot."/><Card className="mb-6"><label className="mb-1.5 block text-sm font-medium">Lot</label><Select value={id} onChange={e=>setId(e.target.value)}><option value="">Select a lot</option>{(lots.data??[]).map(l=><option key={l.publicId??l.id} value={l.publicId??l.id}>{l.crop.name} · {l.quantity} {l.unit} · {l.status}</option>)}</Select><Button className="mt-4 w-auto" disabled={!id} isLoading={decision.isPending} onClick={()=>decision.mutate()}><Sparkles className="h-4 w-4"/> Run decision</Button>{decision.isError&&<Alert variant="error" className="mt-4">The decision engine could not analyse this lot.</Alert>}</Card><div className="grid gap-6 lg:grid-cols-2"><Card><div className="mb-3 flex items-center gap-2"><Scale className="h-5 w-5"/><h2 className="font-semibold">Latest decision</h2></div>{decision.isPending?<LoadingBlock/>:decision.data?<pre className="max-h-[480px] overflow-auto rounded-2xl bg-[#242424] p-5 text-xs leading-5 text-[#f8f4e9]">{JSON.stringify(decision.data,null,2)}</pre>:<p className="text-sm text-muted-foreground">Run an analysis to see SELL_NOW, STORE, or an insufficient-data outcome.</p>}</Card><Card><h2 className="mb-3 font-semibold">Decision history</h2>{history.isLoading?<LoadingBlock/>:history.isError?<p className="text-sm text-muted-foreground">No history available.</p>:<pre className="max-h-[480px] overflow-auto rounded-2xl bg-secondary p-4 text-xs">{JSON.stringify(history.data,null,2)}</pre>}</Card></div></div>}
export default function SellVsStorePage(){return <RoleProtectedPage role="FARMER"><Content/></RoleProtectedPage>}

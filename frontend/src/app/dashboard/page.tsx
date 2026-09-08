"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BarChart3, Building2, Handshake, LineChart, Package, Plus, Scale, ShieldCheck, Sprout, Warehouse, Wheat } from "lucide-react";
import Link from "next/link";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { useAuth } from "@/hooks/useAuth";
import { Alert, Card } from "@/components/ui/primitives";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import { useFarmerProfileQuery } from "@/hooks/useFarmerProfile";
import { ProfileCompletionCard } from "@/components/farmer-profile/ProfileCompletionCard";
import { PageHeader, QuickLinkCard, StatCard } from "@/components/ui/stat-card";
import { ApiRequestError } from "@/types/api";
import { lotApi } from "@/services/lotApi";
import { tradeOfferApi } from "@/services/tradeApi";

function DashboardStats() {
  const lots = useQuery({ queryKey:["lots","mine"], queryFn:()=>lotApi.listMine() });
  const offers = useQuery({ queryKey:["trade-offers","mine"], queryFn:()=>tradeOfferApi.list() });
  const active = lots.data?.filter((x)=>x.status!=="CANCELLED"&&x.status!=="COMPLETED").length;
  const pending = offers.data?.filter((x)=>x.status==="PENDING"||x.status==="COUNTERED").length;
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
    <StatCard label="Active produce" value={active ?? "—"} hint="Lots currently moving" icon={<Package className="h-4 w-4"/>} href="/lots" />
    <StatCard label="Offers to review" value={pending ?? "—"} hint="Need your attention" icon={<Handshake className="h-4 w-4"/>} href="/trade-offers" tone="accent" />
    <StatCard label="All produce lots" value={lots.data?.length ?? "—"} hint="Your listed produce" icon={<Wheat className="h-4 w-4"/>} href="/lots" />
    <StatCard label="Market prices" dataTour="market" value="Check" hint="See today's rates" icon={<LineChart className="h-4 w-4"/>} href="/market" />
  </div>;
}

function RecentProduce() {
  const q=useQuery({queryKey:["lots","mine"],queryFn:()=>lotApi.listMine()});
  if(q.isLoading)return <LoadingBlock/>; if(q.isError)return <ErrorBlock message="Could not load your produce." onRetry={()=>q.refetch()}/>;
  const lots=(q.data??[]).slice(0,4);
  return <Card><div className="flex items-center justify-between mb-4"><div><h2 className="text-lg font-bold">Your produce</h2><p className="text-xs text-muted-foreground mt-1">The latest lots you have listed.</p></div><Link href="/lots" className="text-xs font-bold text-foreground flex items-center gap-1">See all <ArrowRight className="h-3.5 w-3.5"/></Link></div>{lots.length===0?<div className="rounded-xl border border-dashed p-6 text-center"><Package className="mx-auto h-7 w-7 text-muted-foreground"/><p className="mt-2 text-sm font-semibold">No produce listed yet</p><p className="text-xs text-muted-foreground mt-1">Create a lot when your produce is ready for sale.</p><Link href="/lots/new" className="inline-flex mt-4 items-center gap-2 rounded-xl bg-[#24221e] px-4 py-2.5 text-xs font-bold text-white"><Plus className="h-4 w-4"/> Add produce</Link></div>:<div className="divide-y divide-border">{lots.map(l=><Link href={`/lots/${l.id}`} key={l.id} className="flex items-center justify-between gap-3 py-3 hover:bg-[#faf8f3] px-2 rounded-lg"><div className="min-w-0"><p className="font-bold text-sm truncate">{l.crop?.name}{l.variety?` · ${l.variety}`:""}</p><p className="text-xs text-muted-foreground mt-1">{l.quantity} {l.unit}</p></div><Badge tone={toneForStatus(l.status)}>{l.status.replace(/_/g," ")}</Badge></Link>)}</div>}</Card>;
}

const ACTIONS=[
 {title:"Add a farm",description:"Register land, area and irrigation details.",href:"/farms/new",icon:<Sprout/>},
 {title:"List produce",description:"Create a lot and make it available to buyers.",href:"/lots/new",icon:<Package/>},
 {title:"Check market",description:"See mandi prices and market trends.",href:"/market",icon:<LineChart/>},
 {title:"Find storage",description:"Compare nearby warehouses before storing.",href:"/warehouses",icon:<Warehouse/>},
 {title:"Compare sell vs store",description:"Understand your options before deciding.",href:"/sell-vs-store",icon:<Scale/>},
 {title:"Review offers",description:"See buyer offers and continue negotiation.",href:"/trade-offers",icon:<Handshake/>},
];

function DashboardContent(){
 const {user}=useAuth(); if(!user)return null;
 const profile=useFarmerProfileQuery();
 return <div>
  <PageHeader title={`Good to see you, ${user.fullName.split(" ")[0]}.`} description="Here is your farm workspace. Start with what you need to do today." actions={<Link href="/lots/new" className="inline-flex items-center gap-2 rounded-xl bg-[#24221e] px-4 py-2.5 text-xs font-bold text-white shadow-sm"><Plus className="h-4 w-4"/> List produce</Link>}/>
  {user.accountStatus === "PENDING_VERIFICATION" && <Alert variant="info" className="mb-5">Your account is pending verification. Some actions may stay limited until it is confirmed.</Alert>}
  <DashboardStats/>
  <div className="mt-6 grid gap-5 lg:grid-cols-[1.5fr_.8fr]">
   <div className="space-y-5"><RecentProduce/><div><div className="flex items-end justify-between mb-3" data-tour="actions"><div><h2 className="text-lg font-bold">What do you want to do?</h2><p className="text-xs text-muted-foreground mt-1">Simple shortcuts to the most useful tools.</p></div></div><div className="grid gap-3 sm:grid-cols-2">{ACTIONS.map(a=><QuickLinkCard key={a.href} {...a}/>)}</div></div></div>
   <div className="space-y-5">{profile.isLoading?<LoadingBlock/>:profile.isError?<ErrorBlock message={profile.error instanceof ApiRequestError?profile.error.message:"Could not load profile."} onRetry={()=>profile.refetch()}/>:profile.data?<ProfileCompletionCard completion={profile.data.completion} showLinkToProfile/>:null}<Card><h2 className="text-base font-bold">Need a quick view?</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Use these pages when you are making a decision, not just managing data.</p><div className="mt-4 grid gap-2"><Link href="/forecasts" className="flex items-center justify-between rounded-xl bg-[#f5f0e5] px-3 py-3 text-xs font-bold">Price forecast <BarChart3 className="h-4 w-4"/></Link><Link href="/quality" className="flex items-center justify-between rounded-xl bg-[#f5f0e5] px-3 py-3 text-xs font-bold">Quality <ShieldCheck className="h-4 w-4"/></Link><Link href="/fpo-membership" className="flex items-center justify-between rounded-xl bg-[#f5f0e5] px-3 py-3 text-xs font-bold">My FPO <Building2 className="h-4 w-4"/></Link></div></Card></div>
  </div>
 </div>;
}
export default function DashboardPage(){return <RoleProtectedPage role="FARMER"><DashboardContent/></RoleProtectedPage>}

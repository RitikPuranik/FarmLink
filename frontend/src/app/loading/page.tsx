"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { ROLE_HOME_ROUTE } from "@/lib/roleRouting";
import { LogoMark } from "@/components/Logo";

export default function LoadingPage(){
 const {user,isLoading}=useAuth(); const router=useRouter();
 useEffect(()=>{ if(!isLoading && user){ const timer=setTimeout(()=>router.replace(ROLE_HOME_ROUTE[user.role]),700); return ()=>clearTimeout(timer); } if(!isLoading&&!user)router.replace('/login'); },[isLoading,user,router]);
 return <main className="min-h-screen bg-[#24221e] text-white grid place-items-center px-6"><div className="text-center"><div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[#e3b23c] text-[#24221e] shadow-[0_15px_50px_rgba(227,178,60,.18)]"><LogoMark className="h-8 w-8"/></div><h1 className="mt-6 text-2xl font-bold tracking-tight">Getting your workspace ready</h1><p className="mt-2 text-sm text-white/50">Loading your Anndata dashboard…</p><div className="mx-auto mt-6 h-1 w-44 overflow-hidden rounded-full bg-white/10"><div className="h-full w-1/2 animate-pulse rounded-full bg-[#e3b23c]"/></div></div></main>
}

"use client";
import Link from "next/link";
import { useActionState } from "react";
import { verifyRecovery } from "./actions";
import { authButton } from "@/components/password-fields";

export default function VerifyRecoveryForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(verifyRecovery, { error: "" });
  return <form action={action} className="space-y-5"><input type="hidden" name="token_hash" value={token}/><input type="hidden" name="type" value="recovery"/>{state.error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{state.error}</p>}<button disabled={pending} className={authButton}>{pending ? "Yoxlanılır…" : "Bərpanı davam et"}</button><Link href="/forgot-password" className="inline-block min-h-11 py-3 text-sm font-medium text-emerald-800">Yeni bərpa keçidi istə</Link></form>;
}

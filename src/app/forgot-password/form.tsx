"use client";
import Link from "next/link";
import { useActionState } from "react";
import { requestRecovery } from "./actions";
import { authButton, authInput } from "@/components/password-fields";

export default function RecoveryRequestForm() {
  const [state, action, pending] = useActionState(requestRecovery, { error: "" });
  return <div className="space-y-5">{state.sent ? <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm leading-6 text-emerald-800">Bu emailə bağlı hesab varsa, bərpa keçidi göndəriləcək. Gələnlər və spam qovluğunu yoxla. Məktub gəlməzsə bir qədər sonra yenidən cəhd et və ya adminlə əlaqə saxla.</p> : <form action={action} className="space-y-5"><div><label htmlFor="email" className="mb-2 block text-sm font-medium">Email</label><input id="email" name="email" type="email" autoComplete="email" required maxLength={254} disabled={pending} className={authInput}/></div>{state.error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{state.error}</p>}<button disabled={pending} className={authButton}>{pending ? "Göndərilir…" : "Bərpa keçidi göndər"}</button></form>}<Link href="/login" className="inline-block min-h-11 py-3 text-sm font-medium text-emerald-800">Girişə qayıt</Link></div>;
}

"use client";
import Link from "next/link";
import { useActionState } from "react";
import { resetPassword } from "../recovery/actions";
import PasswordFields, { authButton } from "@/components/password-fields";

export default function NewPasswordForm() {
  const [state, action, pending] = useActionState(resetPassword, { error: "" });
  return <form action={action} className="space-y-4">{!state.retry && <PasswordFields pending={pending}/>} {state.error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm leading-6 text-red-700">{state.error}</p>}{state.retry ? <div className="flex flex-wrap gap-x-5"><Link href="/login" className="min-h-11 py-3 text-sm font-semibold text-emerald-800">Yeni şifrə ilə giriş yoxla</Link><Link href="/forgot-password" className="min-h-11 py-3 text-sm font-semibold text-emerald-800">Yeni bərpa keçidi istə</Link></div> : <button disabled={pending} className={authButton}>{pending ? "Yenilənir…" : "Yeni şifrəni yadda saxla"}</button>}</form>;
}

"use client";
import Link from "next/link";
import { useActionState } from "react";
import { changePassword } from "./actions";
import PasswordFields, { authButton } from "@/components/password-fields";

export default function AccountForm() {
  const [state, action, pending] = useActionState(changePassword, { error: "" });
  return <form action={action} className="space-y-4"><PasswordFields pending={pending} current/>{state.error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm leading-6 text-red-700">{state.error}</p>}<button disabled={pending} className={authButton}>{pending ? "Yenilənir…" : "Şifrəni dəyiş"}</button><Link href="/admin" className="inline-block min-h-11 py-3 text-sm font-semibold text-emerald-800">Panelə qayıt</Link></form>;
}

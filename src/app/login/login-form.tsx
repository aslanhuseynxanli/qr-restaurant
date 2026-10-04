"use client";

import { useActionState, useState } from "react";
import { signInAction } from "./actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState(signInAction, {
    error: "",
  });

  const [showPassword, setShowPassword] = useState(false);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-5 py-12 text-slate-900">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-400 text-xl font-black text-slate-950">
            QR
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-white">
            QR Restoran
          </h1>

          <p className="mt-2 text-sm text-slate-400">
            Restoran idarəetmə paneli
          </p>
        </div>

        <form
          action={action}
          className="space-y-5 rounded-3xl bg-white p-7 shadow-xl sm:p-9"
        >
          <div>
            <h2 className="text-xl font-semibold">Hesabına daxil ol</h2>
            <p className="mt-1 text-sm text-slate-500">
              İdarəetmə üçün email və şifrəni yaz.
            </p>
          </div>

          <div>
            <label
              htmlFor="email"
              className="mb-2 block text-sm font-medium"
            >
              Email
            </label>

            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              maxLength={254}
              placeholder="email@example.com"
              disabled={pending}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-2 block text-sm font-medium"
            >
              Şifrə
            </label>

            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                maxLength={1024}
                disabled={pending}
                className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-4 pr-24 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60"
              />

              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                disabled={pending}
                aria-label={
                  showPassword ? "Şifrəni gizlət" : "Şifrəni göstər"
                }
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-3 text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                {showPassword ? "Gizlət" : "Göstər"}
              </button>
            </div>
          </div>

          {state.error && (
            <p
              role="alert"
              className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
          >
            {pending ? "Daxil olunur…" : "Daxil ol"}
          </button>
        </form>
      </div>
    </main>
  );
}
"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createRestaurantAction } from "./actions";

function makeSlug(value: string) {
  const letters: Record<string, string> = {
    ə: "e",
    ı: "i",
    ö: "o",
    ü: "u",
    ş: "s",
    ç: "c",
    ğ: "g",
  };

  return value
    .toLowerCase()
    .replace(/[əıöüşçğ]/g, (letter) => letters[letter])
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export default function RestaurantForm() {
  const [state, action, pending] = useActionState(
    createRestaurantAction,
    { error: "" },
  );

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const inputClass =
    "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60";

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900">
      <div className="mx-auto max-w-xl">
        <Link
          href="/admin"
          className="text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          ← Panelə qayıt
        </Link>

        <h1 className="mt-6 text-2xl font-bold">Restoran əlavə et</h1>

        <p className="mt-2 text-sm text-slate-500">
          Yeni restoran sınaq statusunda açılacaq.
        </p>

        <form
          action={action}
          className="mt-6 space-y-5 rounded-2xl border border-slate-200 bg-white p-6"
        >
          <div>
            <label
              htmlFor="name"
              className="mb-2 block text-sm font-medium"
            >
              Restoran adı
            </label>

            <input
              id="name"
              name="name"
              required
              maxLength={150}
              disabled={pending}
              value={name}
              onChange={(event) => {
                setName(event.target.value);

                if (!slugEdited) {
                  setSlug(makeSlug(event.target.value));
                }
              }}
              placeholder="Sınaq Restoranı"
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor="slug"
              className="mb-2 block text-sm font-medium"
            >
              Keçid adı
            </label>

            <input
              id="slug"
              name="slug"
              required
              maxLength={80}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              autoCapitalize="none"
              spellCheck={false}
              disabled={pending}
              value={slug}
              onChange={(event) => {
                setSlugEdited(true);
                setSlug(event.target.value.toLowerCase());
              }}
              placeholder="sinaq-restorani"
              className={inputClass}
            />

            <p className="mt-2 text-xs text-slate-500">
              QR menyunun ünvanında istifadə olunacaq. İstəsən dəyişə bilərsən.
            </p>
          </div>

          <div>
            <label
              htmlFor="phone"
              className="mb-2 block text-sm font-medium"
            >
              Telefon — istəyə bağlı
            </label>

            <input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              maxLength={30}
              disabled={pending}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+994 50 123 45 67"
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor="email"
              className="mb-2 block text-sm font-medium"
            >
              Email — istəyə bağlı
            </label>

            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              disabled={pending}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="restoran@example.com"
              className={inputClass}
            />
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
            className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
          >
            {pending ? "Yaradılır…" : "Restoranı yarat"}
          </button>
        </form>
      </div>
    </main>
  );
}
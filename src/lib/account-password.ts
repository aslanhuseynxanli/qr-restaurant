export type PasswordState = { error: string; sent?: boolean; retry?: boolean };

export function passwordError(password: unknown, confirmation: unknown): string {
  if (typeof password !== "string" || typeof confirmation !== "string") return "Yeni şifrəni və təkrarını yaz.";
  if (password.length < 10 || password.length > 128 || !/\p{L}/u.test(password) || !/\d/.test(password)) return "Yeni şifrə 10–128 simvol olmalı, hərf və rəqəm daxil edilməlidir.";
  if (password !== confirmation) return "Yeni şifrələrin təkrarı uyğun gəlmir.";
  return "";
}

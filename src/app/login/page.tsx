import LoginForm from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ password?: string | string[] }> }) {
  return <LoginForm passwordChanged={(await searchParams).password === "changed"} />;
}

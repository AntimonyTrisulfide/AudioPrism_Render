import { useState } from "react";
import { useForm } from "react-hook-form";
import { Loader2, LockKeyhole, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PrismLogo } from "@/components/PrismLogo";

type LoginForm = { email: string; password: string };
type SignupForm = { username: string; email: string; password: string; confirmPassword: string };
type AuthUser = { id?: string; username?: string; email?: string };

type AuthPageProps = {
  apiBase?: string;
  onAuthenticated: (token: string, user?: AuthUser | null) => void;
};

export default function AuthPage({ apiBase = "/api/auth", onAuthenticated }: AuthPageProps) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const login = useForm<LoginForm>();
  const signup = useForm<SignupForm>();

  async function request(path: string, body: object) {
    setLoading(true);
    try {
      const response = await fetch(`${apiBase.replace(/\/$/, "")}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "Authentication failed.");
      if (!payload.token) throw new Error("The backend did not return a session token.");
      onAuthenticated(payload.token, payload.user);
    } finally {
      setLoading(false);
    }
  }

  const submitLogin = login.handleSubmit(async (values) => {
    try {
      await request("login", { email: values.email.trim().toLowerCase(), password: values.password });
      toast.success("Welcome back.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Login failed.");
    }
  });

  const submitSignup = signup.handleSubmit(async (values) => {
    if (values.password !== values.confirmPassword) return toast.error("Passwords do not match.");
    try {
      await request("register", {
        username: values.username.trim(),
        email: values.email.trim().toLowerCase(),
        password: values.password,
      });
      toast.success("Account created.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign up failed.");
    }
  });

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8 text-slate-100">
      <div className="grid min-w-0 w-full max-w-5xl items-center gap-8 md:grid-cols-[1fr_1.1fr]">
        <div className="min-w-0">
          <PrismLogo size="lg" />
        </div>
        <div className="min-w-0 w-full max-w-md justify-self-center">
        <section className="border border-white/10 bg-slate-950/70 p-5 shadow-[0_25px_80px_rgba(2,6,23,0.9)] backdrop-blur-2xl sm:p-7">
          <Tabs value={mode} onValueChange={(value) => setMode(value as "login" | "signup")}>
            <TabsList className="grid w-full grid-cols-2 bg-white/10">
              <TabsTrigger value="login">Log in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="mt-6">
              <form onSubmit={submitLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input id="login-email" type="email" autoComplete="email" {...login.register("email", { required: "Email is required." })} />
                  {login.formState.errors.email && <p className="text-xs text-red-300">{login.formState.errors.email.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">Password</Label>
                  <Input id="login-password" type="password" autoComplete="current-password" {...login.register("password", { required: "Password is required." })} />
                  {login.formState.errors.password && <p className="text-xs text-red-300">{login.formState.errors.password.message}</p>}
                </div>
                <Button className="h-11 w-full bg-cyan-300 text-slate-950 hover:bg-cyan-200" disabled={loading}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LockKeyhole className="mr-2 h-4 w-4" />}
                  {loading ? "Signing in" : "Log in"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-6">
              <form onSubmit={submitSignup} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-name">Username</Label>
                  <Input id="signup-name" autoComplete="username" {...signup.register("username", { required: "Username is required." })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input id="signup-email" type="email" autoComplete="email" {...signup.register("email", { required: "Email is required." })} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <Input id="signup-password" type="password" autoComplete="new-password" {...signup.register("password", { required: true, minLength: 6 })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-confirm">Confirm</Label>
                    <Input id="signup-confirm" type="password" autoComplete="new-password" {...signup.register("confirmPassword", { required: true })} />
                  </div>
                </div>
                <Button className="h-11 w-full bg-cyan-300 text-slate-950 hover:bg-cyan-200" disabled={loading}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                  {loading ? "Creating account" : "Create account"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </section>

        <p className="mt-4 text-center text-xs text-slate-500">Your processing history is private to this account.</p>
        </div>
      </div>
    </main>
  );
}

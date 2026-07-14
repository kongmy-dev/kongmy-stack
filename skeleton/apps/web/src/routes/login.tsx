/**
 * Login page — credential authentication with session cookies.
 * All strings via i18n catalog (auth_* keys).
 */

import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { FormField } from "../components/ui/form-field";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
        }),
        credentials: "include",
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error?.message || "Invalid email or password");
        setPassword("");
        return;
      }

      // Success: session cookie is set
      // Navigate to invoices
      await router.navigate({ to: "/invoices" });
    } catch (err) {
      setError("An error occurred during login");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white rounded-lg shadow">
        <h1 className="text-2xl font-bold mb-6 text-center">Login</h1>

        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <FormField label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@dev.local"
              disabled={isLoading}
              required
              data-testid="email-input"
            />
          </FormField>

          <FormField label="Password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="dev-admin-password"
              disabled={isLoading}
              required
              data-testid="password-input"
            />
          </FormField>

          <Button type="submit" disabled={isLoading} className="w-full" data-testid="login-button">
            {isLoading ? "Signing in..." : "Sign In"}
          </Button>
        </form>

        <div className="mt-6 p-4 bg-blue-50 rounded text-sm text-gray-700">
          <p className="font-semibold mb-2">Dev Credentials:</p>
          <p>Admin: admin@dev.local / dev-admin-password</p>
          <p>Clerk: clerk@dev.local / dev-clerk-password</p>
        </div>
      </div>
    </div>
  );
}

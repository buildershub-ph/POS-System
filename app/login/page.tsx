import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = {
  title: "Sign In | Builders Hub",
};

export default function LoginPage() {
  return <main className="login-page"><section className="login-intro"><div className="login-intro__content"><p className="eyebrow">One trusted system</p><h2>Inventory your whole team can rely on.</h2><p>Fast barcode lookup, clear product photographs and immutable stock records—without exposing private costs.</p><div className="login-feature-list"><span><i>✓</i> Role-specific access</span><span><i>✓</i> Android, iOS and desktop</span><span><i>✓</i> Every stock change audited</span></div></div></section><LoginForm /></main>;
}


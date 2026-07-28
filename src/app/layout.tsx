import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/primitives";
import { Shell } from "@/components/shell";

export const metadata: Metadata = {
  title: "Atlas — design knowledge base",
  description:
    "Turns UI screenshots into machine-reusable design briefs Claude Code can build from.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Set the theme before first paint — a flash of the wrong ground is
            exactly the kind of thing this app is supposed to notice. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("atlas-theme");if(t)document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <Shell>{children}</Shell>
        <Toaster />
      </body>
    </html>
  );
}

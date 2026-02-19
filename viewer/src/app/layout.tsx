import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";
import { Main } from "@/components/Main";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { RequirementProvider } from "@/contexts/RequirementContext";
import { TabProvider } from "@/contexts/TabContext";
import { TabNotificationMount } from "@/hooks/useTabNotification";
import { computeWorkspaceId } from "@/lib/workspace-id.server";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Botool Agent Viewer",
  description: "Visual interface for BotoolAgent autonomous development",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const workspaceId = computeWorkspaceId();

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased flex h-screen flex-col overflow-hidden bg-neutral-50`}
      >
        <ProjectProvider workspaceId={workspaceId}>
          <RequirementProvider>
            <TabProvider>
              <TabNotificationMount />
              <Header />
              <Main>{children}</Main>
            </TabProvider>
          </RequirementProvider>
        </ProjectProvider>
      </body>
    </html>
  );
}

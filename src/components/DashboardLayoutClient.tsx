"use client";

import React, { useState } from "react";
import Sidebar from "@/components/sidebar";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu, Activity } from "lucide-react";
import { UserRole, Department } from "@/types";

interface DashboardLayoutClientProps {
  children: React.ReactNode;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
    department: Department | null;
  };
}

export default function DashboardLayoutClient({
  children,
  user,
}: DashboardLayoutClientProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  return (
    <div className="flex flex-col md:flex-row h-screen bg-background overflow-hidden">
      {/* Static Sidebar for Desktop */}
      <Sidebar user={user} className="hidden md:flex" />

      {/* Slide-out Drawer for Mobile */}
      <Sheet open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <SheetContent side="left" className="p-0 w-64 max-w-xs border-r border-slate-200 dark:border-slate-800" showCloseButton={false}>
          <Sidebar user={user} onLinkClick={() => setIsDrawerOpen(false)} className="w-full h-full border-r-0" />
        </SheetContent>
      </Sheet>

      {/* Main Content Wrapper */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Navbar for Mobile Viewports */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200/60 dark:border-slate-800/60 bg-white dark:bg-slate-900 md:hidden z-30 select-none">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-white shadow-md shadow-primary/10">
              <Activity className="h-4 w-4 stroke-[2.5]" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-sm text-slate-900 dark:text-white leading-tight">
                KlinikAid
              </span>
              <span className="text-[9px] text-slate-500 dark:text-slate-400 font-medium">
                Bloodcare Lab Portal
              </span>
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsDrawerOpen(true)}
            className="text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 h-full overflow-y-auto bg-background">
          <div className="container mx-auto px-4 py-6 md:px-6 md:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

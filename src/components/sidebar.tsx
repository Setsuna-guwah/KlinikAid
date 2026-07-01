"use client";

import React, { useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/(auth)/logout/actions";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { USER_ROLES, DEPARTMENTS } from "@/lib/constants";
import { UserRole, Department } from "@/types";
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  FileText,
  Brain,
  History,
  FileSpreadsheet,
  UserCheck,
  Bot,
  Upload,
  Search,
  LogOut,
  Activity,
  Loader2,
} from "lucide-react";

interface SidebarProps {
  user: {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
    department: Department | null;
  };
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

export default function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const handleLogout = () => {
    startTransition(async () => {
      await logoutAction();
    });
  };

  // Define nav items for each role
  const navItemsMap: Record<UserRole, NavItem[]> = {
    admin: [
      { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
      { label: "Staff Management", href: "/admin/staff", icon: Users },
      { label: "Reception Queue", href: "/reception/queue", icon: ClipboardList },
      { label: "Dept Records", href: "/department/records", icon: FileSpreadsheet },
      { label: "RAG Manager", href: "/admin/rag", icon: Brain },
      { label: "System Logs", href: "/admin/logs", icon: History },
    ],
    receptionist: [
      { label: "Dashboard", href: "/reception/dashboard", icon: LayoutDashboard },
      { label: "Reception Queue", href: "/reception/queue", icon: ClipboardList },
    ],
    department_staff: [
      { label: "My Dept Records", href: "/department/records", icon: FileSpreadsheet },
      { label: "Record Entry", href: "/department/entry", icon: FileText },
    ],
    medical_specialist: [
      { label: "Dashboard", href: "/specialist/dashboard", icon: LayoutDashboard },
      { label: "My Patients", href: "/specialist/patients", icon: UserCheck },
    ],
    patient: [
      { label: "Dashboard", href: "/patient/dashboard", icon: LayoutDashboard },
      { label: "AI Assistant", href: "/patient/chat", icon: Bot },
      { label: "Submit Document", href: "/patient/submit", icon: Upload },
      { label: "Track Submission", href: "/patient/submissions", icon: Search },
      { label: "My Results", href: "/patient/results", icon: FileText },
    ],
  };

  const navItems = navItemsMap[user.role] || [];
  const roleInfo = USER_ROLES[user.role];
  const deptInfo = user.department ? DEPARTMENTS[user.department] : null;

  return (
    <aside className="flex flex-col w-64 h-screen border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 select-none">
      {/* Sidebar Header / Branding */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-200/60 dark:border-slate-800/60">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary text-white shadow-md shadow-primary/10">
          <Activity className="h-5 w-5 stroke-[2.5]" />
        </div>
        <div className="flex flex-col">
          <span className="font-bold text-slate-900 dark:text-white leading-tight">
            KlinikAid
          </span>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
            Bloodcare Lab Portal
          </span>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group",
                isActive
                  ? "bg-primary/10 text-primary dark:bg-primary/20 dark:text-emerald-400"
                  : "text-slate-600 hover:text-slate-950 hover:bg-slate-50 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/50"
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 transition-transform group-hover:scale-105 duration-200",
                  isActive
                    ? "text-primary dark:text-emerald-400"
                    : "text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300"
                )}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User Session profile & Sign out */}
      <div className="p-4 border-t border-slate-200/60 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/30">
        <div className="flex flex-col space-y-3">
          {/* User Badge Info */}
          <div className="flex flex-col space-y-1 px-2">
            <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">
              {user.fullName}
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
              {user.email}
            </span>
            <div className="flex flex-wrap gap-1 mt-1.5">
              <Badge className={cn("text-[9px] px-1.5 py-0 font-semibold tracking-wide uppercase shadow-none", roleInfo?.color)}>
                {roleInfo?.label || user.role}
              </Badge>
              {deptInfo && (
                <Badge className={cn("text-[9px] px-1.5 py-0 font-semibold tracking-wide uppercase shadow-none", deptInfo.color)}>
                  {deptInfo.label}
                </Badge>
              )}
            </div>
          </div>

          {/* Logout Button */}
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 px-3.5 text-slate-600 hover:text-red-600 hover:bg-red-50 dark:text-slate-400 dark:hover:text-red-400 dark:hover:bg-red-950/20 text-sm font-medium transition-all"
            onClick={handleLogout}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin text-red-500" />
            ) : (
              <LogOut className="h-4 w-4 text-slate-400 group-hover:text-red-500" />
            )}
            Sign Out
          </Button>
        </div>
      </div>
    </aside>
  );
}

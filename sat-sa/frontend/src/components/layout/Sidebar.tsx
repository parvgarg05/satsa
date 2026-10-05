import React from 'react';
import { 
  Shield, LayoutDashboard, Building2, AlertTriangle, 
  Database, Scale, Server, FileText, PlayCircle, Lock
} from 'lucide-react';

export type NavigationPage = 
  | 'dashboard'
  | 'entities'
  | 'findings'
  | 'evidence'
  | 'analytics'
  | 'system'
  | 'about'
  | 'workflow'
  | 'alert-review'
  | 'report'
  | 'trends'
  | 'validation';

interface SidebarProps {
  currentPage: NavigationPage;
  onNavigate: (page: NavigationPage) => void;
  entityCount?: number;
  findingCount?: number;
}

export function Sidebar({ currentPage, onNavigate, entityCount, findingCount }: SidebarProps) {
  const navItems: Array<{
    section?: string;
    id: NavigationPage;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
  }> = [
    { section: 'Overview', id: 'dashboard', label: 'Supervisory Dashboard', icon: LayoutDashboard },
    { section: 'Workflow', id: 'workflow', label: 'Analysis Workflow', icon: PlayCircle },
    { section: 'Investigate', id: 'entities', label: 'Entities', icon: Building2, count: entityCount },
    { id: 'findings', label: 'Supervisory Signals', icon: AlertTriangle, count: findingCount },
      { id: 'alert-review', label: 'Alert Review Queue', icon: AlertTriangle },
    { section: 'Data', id: 'evidence', label: 'Evidence Explorer', icon: Database },
    { section: 'Analytics', id: 'trends', label: 'Temporal Trends', icon: Scale },
      { id: 'validation', label: 'Manual Validation', icon: Scale },
      { id: 'analytics', label: 'Risk Methodology', icon: Scale },
      { section: 'Export', id: 'report', label: 'Supervisory Report', icon: FileText },
    { section: 'System', id: 'system', label: 'System Status', icon: Server },
    { id: 'about', label: 'About & Scope', icon: FileText },
  ];

  return (
    <aside className="print:hidden w-56 bg-app-sidebar border-r border-app-borderDivider flex flex-col shrink-0 select-none h-screen sticky top-0 transition-colors">
      {/* Brand Header */}
      <div className="p-4 border-b border-app-borderDivider flex items-center space-x-2.5">
        <div className="p-1.5 rounded bg-transparent border border-app-borderDivider text-app-heading">
          <Shield className="w-4 h-4" />
        </div>
        <div>
          <div className="flex items-center space-x-1.5">
            <span className="font-semibold text-app-heading text-sm tracking-tight">SAT-SA</span>
            <span className="text-[10px] font-normal px-1.5 py-0.2 rounded bg-transparent text-app-muted border border-app-borderDivider">
              PS-157
            </span>
          </div>
          <p className="text-[11px] text-app-muted">Supervisory Assessment</p>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-0.5">
        {navItems.map((item, idx) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;

          return (
            <React.Fragment key={item.id}>
              {item.section && (
                <div className={`text-[11px] font-medium text-app-muted uppercase tracking-wider px-2.5 pb-1 ${idx > 0 ? 'pt-4' : 'pt-1'}`}>
                  {item.section}
                </div>
              )}
              <button
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs transition-colors text-left rounded-r ${
                  isActive
                    ? 'bg-app-navActiveBg text-app-navActiveText font-medium border-l-2 border-l-app-navActiveIndicator'
                    : 'text-app-navInactiveText hover:text-app-heading hover:bg-app-surfaceHover border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center space-x-2.5 truncate">
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-app-navActiveText' : 'text-app-muted'}`} />
                  <span className="truncate">{item.label}</span>
                </div>
                {item.count !== undefined && item.count > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded ${
                    isActive ? 'bg-transparent text-app-navActiveText font-medium' : 'text-app-muted'
                  }`}>
                    {item.count}
                  </span>
                )}
              </button>
            </React.Fragment>
          );
        })}
      </nav>

      {/* Bottom Status / Air-Gapped Footer */}
      <div className="p-3 border-t border-app-borderDivider bg-transparent text-xs">
        <div className="flex items-center space-x-1.5 text-app-secondary text-[11px] font-medium mb-0.5">
          <Lock className="w-3 h-3 text-app-muted shrink-0" />
          <span>Air-Gapped Operation</span>
        </div>
        <p className="text-[10px] text-app-muted leading-tight">
          Offline Local Engine • SQLite
        </p>
      </div>
    </aside>
  );
}

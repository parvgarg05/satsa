import React, { useState, useRef, useEffect } from 'react';
import { Sun, Moon, ArrowLeft, Folder, ChevronDown, Check, Plus, Database, Trash2 } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import type { AssessmentInfo } from '../../types/api';

interface TopHeaderProps {
  currentSection: string;
  currentPageTitle: string;
  subTitle?: string;
  onNavigateToSystem?: () => void;
  canGoBack?: boolean;
  onBack?: () => void;
  onNavigateToDashboard?: () => void;
  activeAssessment?: AssessmentInfo | null;
  assessments?: AssessmentInfo[];
  onSwitchAssessment?: (id: string) => Promise<void> | void;
  onDeleteAssessment?: (id: string) => Promise<void> | void;
  onNavigateToWorkflow?: () => void;
}

export function TopHeader({ 
  currentSection, 
  currentPageTitle, 
  subTitle,
  onNavigateToSystem,
  canGoBack,
  onBack,
  onNavigateToDashboard,
  activeAssessment,
  assessments = [],
  onSwitchAssessment,
  onDeleteAssessment,
  onNavigateToWorkflow
}: TopHeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [dropdownOpen]);

  const handleSelect = async (id: string) => {
    if (id === activeAssessment?.assessment_id || switching) return;
    setSwitching(true);
    try {
      if (onSwitchAssessment) {
        await onSwitchAssessment(id);
      }
    } finally {
      setSwitching(false);
      setDropdownOpen(false);
    }
  };

  return (
    <header className="print:hidden h-12 border-b border-app-borderDivider bg-app-header px-4 sm:px-6 flex items-center justify-between shrink-0 select-none shadow-sm relative z-30">
      {/* Contextual Breadcrumbs & Back Navigation */}
      <div className="flex items-center space-x-2 text-xs truncate">
        {canGoBack && (
          <button
            onClick={onBack}
            title="Go back to previous page"
            className="inline-flex items-center px-2 py-1 rounded text-app-muted hover:text-app-heading hover:bg-app-surface2 border border-app-borderBtn mr-1 transition-colors text-xs"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
            <span>Back</span>
          </button>
        )}
        <button
          onClick={onNavigateToDashboard}
          title="Return to Overview"
          className="text-app-muted hover:text-app-heading text-xs transition-colors"
        >
          {currentSection}
        </button>
        <span className="text-app-muted text-xs">/</span>
        <span className="text-app-heading font-medium text-xs truncate">{currentPageTitle}</span>
        {subTitle && (
          <>
            <span className="text-app-muted text-xs">/</span>
            <span className="text-app-heading font-medium font-mono text-xs truncate">{subTitle}</span>
          </>
        )}
      </div>

      {/* Assessment Selector & Technical Status */}
      <div className="flex items-center space-x-3 text-xs shrink-0">
        {/* Assessment Switcher Dropdown */}
        {activeAssessment && (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded border border-app-borderBtn bg-app-surface2 hover:bg-app-surface text-app-text transition-colors text-xs shadow-xs"
              title="Current Assessment Period (Click to switch or create)"
            >
              <Folder className="w-3.5 h-3.5 text-app-accent" />
              <span className="text-[11px] text-app-muted hidden sm:inline">Assessment:</span>
              <span className="text-[11px] font-medium text-app-heading truncate max-w-[110px] md:max-w-[150px]">
                {activeAssessment.name || activeAssessment.assessment_id}
              </span>
              <ChevronDown className={`w-3 h-3 text-app-muted transition-transform duration-150 ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 mt-1 w-72 sm:w-80 bg-app-surface border border-app-borderDivider rounded-md shadow-lg py-1.5 z-50 text-xs">
                <div className="px-3 py-1.5 border-b border-app-borderDivider flex items-center justify-between">
                  <span className="font-semibold text-app-heading text-[11px]">Assessment Periods</span>
                  <span className="text-[10px] text-app-muted font-mono">{assessments.length} stored</span>
                </div>

                <div className="max-h-60 overflow-y-auto py-1">
                  {assessments.map((a) => {
                    const isActive = a.assessment_id === activeAssessment.assessment_id;
                    const isDefault = a.assessment_id === 'ASM-DEFAULT';
                    return (
                      <div
                        key={a.assessment_id}
                        className={`w-full px-3 py-2 flex items-center justify-between transition-colors ${
                          isActive 
                            ? 'bg-app-accent/10 border-l-2 border-app-accent' 
                            : 'hover:bg-app-surface2 text-app-secondary hover:text-app-heading'
                        }`}
                      >
                        <div
                          onClick={() => handleSelect(a.assessment_id)}
                          role="button"
                          tabIndex={0}
                          className="flex items-start space-x-2.5 min-w-0 flex-1 cursor-pointer select-none"
                        >
                          <div className="pt-0.5 shrink-0">
                            {isActive ? (
                              <Check className="w-3.5 h-3.5 text-app-accent" />
                            ) : (
                              <Database className="w-3.5 h-3.5 text-app-muted" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center space-x-2">
                              <span className={`font-medium truncate ${isActive ? 'text-app-heading font-semibold' : 'text-app-text'}`}>
                                {a.name}
                              </span>
                            </div>
                            <div className="text-[10px] text-app-muted font-mono mt-0.5 flex items-center space-x-2">
                              <span>{a.assessment_id}</span>
                              <span>·</span>
                              <span>{a.counts?.entities ?? 0} entities</span>
                              <span>·</span>
                              <span>{a.counts?.alerts ?? 0} alerts</span>
                            </div>
                          </div>
                        </div>

                        <div className="shrink-0 ml-2 flex items-center space-x-1.5">
                          {isActive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-app-accent/20 text-app-accent font-medium uppercase tracking-wider">
                              Active
                            </span>
                          )}
                          {!isActive && !isDefault && onDeleteAssessment && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteAssessment(a.assessment_id);
                              }}
                              title={`Delete assessment ${a.name || a.assessment_id}`}
                              className="p-1 rounded text-app-muted hover:text-red-500 hover:bg-app-surface border border-transparent hover:border-red-500/20 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {onNavigateToWorkflow && (
                  <div className="p-2 border-t border-app-borderDivider">
                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        onNavigateToWorkflow();
                      }}
                      className="w-full flex items-center justify-center space-x-1.5 py-1.5 px-3 rounded bg-app-accent text-white hover:bg-app-accentHover transition-colors text-xs font-medium"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Start New Assessment</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <span className="text-app-muted text-xs hidden md:inline">
          Local engine · SQLite
        </span>
        <span className="text-app-muted text-xs">
          Air-gapped
        </span>

        {/* Understated Enterprise Theme Toggle */}
        <button
          onClick={toggleTheme}
          title={`Switch to ${theme === 'dark' ? 'Light (Warm Cream)' : 'Dark'} mode`}
          className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-transparent text-app-secondary hover:text-app-heading hover:bg-app-surface2 transition-colors text-xs font-normal"
        >
          {theme === 'dark' ? (
            <>
              <Sun className="w-3.5 h-3.5 text-app-muted" />
              <span className="text-[11px]">Light</span>
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5 text-app-muted" />
              <span className="text-[11px]">Dark</span>
            </>
          )}
        </button>
      </div>
    </header>
  );
}

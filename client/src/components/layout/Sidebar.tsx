import React from "react";
import { Download, MonitorPlay, Music, FileText, Archive, Layers, HardDrive, Calendar, ShieldCheck, Zap, Globe, Lock, ArrowDownToLine, MousePointer2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FileType } from "@/lib/mock-data";

import generatedLogo from "@assets/generated_images/modern_3d_metallic_download_manager_icon_with_down_arrow.png";

interface SidebarProps {
  activeFilter: FileType | "all";
  onFilterChange: (filter: FileType | "all") => void;
  onOpenAdvanced: (tab?: string) => void;
  storageUsage: number; // percentage
}

export function Sidebar({ activeFilter, onFilterChange, onOpenAdvanced, storageUsage }: SidebarProps) {
  const categories = [
    { id: "all", label: "All Downloads", icon: Layers },
    { id: "video", label: "Video", icon: MonitorPlay },
    { id: "audio", label: "Music", icon: Music },
    { id: "archive", label: "Compressed", icon: Archive },
    { id: "document", label: "Documents", icon: FileText },
  ];

  return (
    <div className="w-64 border-r border-border bg-card/30 flex flex-col h-full backdrop-blur-md relative group">
      {/* Main Window Controls - Unified Style */}
      <div className="absolute top-4 right-4 flex gap-2 z-20" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <button
          onClick={() => (window as any).electronAPI?.minimize?.()}
          className="w-3 h-3 rounded-full bg-[#febc2e] hover:bg-[#febc2ecc] border border-[#d8a120] transition-colors"
          title="Minimize"
        />
        <button
          onClick={() => (window as any).electronAPI?.close?.()}
          className="w-3 h-3 rounded-full bg-[#ff5f57] hover:bg-[#ff5f57cc] border border-[#e0443e] transition-colors"
          title="Close"
        />
      </div>

      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 rounded bg-primary/20 border border-primary/30 flex items-center justify-center overflow-hidden">
          {/* Use the generated image if available, else fallback */}
          <img src={generatedLogo} alt="Logo" className="w-full h-full object-cover" />
        </div>
        <div className="leading-none">
          <h1 className="font-bold tracking-tight">Nexus</h1>
          <span className="text-[10px] text-primary font-mono tracking-widest uppercase">Manager</span>
        </div>
      </div>

      <div className="px-3 py-2 flex-1 overflow-y-auto">
        <div className="space-y-1">
          <h2 className="px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Library</h2>
          {categories.map((cat) => (
            <Button
              key={cat.id}
              variant={activeFilter === cat.id ? "secondary" : "ghost"}
              className={cn(
                "w-full justify-start gap-3 h-10 transition-all duration-200",
                activeFilter === cat.id
                  ? "bg-primary/10 text-primary hover:bg-primary/15 font-medium border border-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              )}
              onClick={() => onFilterChange(cat.id as any)}
              data-testid={`link-filter-${cat.id}`}
            >
              <cat.icon className={cn("w-4 h-4", activeFilter === cat.id && "text-primary")} />
              {cat.label}
            </Button>
          ))}
        </div>

        <div className="mt-8 space-y-1">
          <h2 className="px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Features</h2>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground hover:bg-white/5 h-10"
            data-testid="link-scheduler"
            onClick={() => onOpenAdvanced("scheduler")}
          >
            <Calendar className="w-4 h-4" />
            Scheduler
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground hover:bg-white/5 h-10"
            data-testid="link-browser"
            onClick={() => onOpenAdvanced("browser")}
          >
            <Globe className="w-4 h-4" />
            Browser Integration
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground hover:bg-white/5 h-10"
            data-testid="link-proxy"
            onClick={() => onOpenAdvanced("proxy")}
          >
            <ArrowDownToLine className="w-4 h-4" />
            Proxy Settings
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground hover:bg-white/5 h-10"
            data-testid="link-drag-drop"
            onClick={() => onOpenAdvanced("browser")}
          >
            <MousePointer2 className="w-4 h-4" />
            Drag & Drop
          </Button>
        </div>

        <div className="mt-8 space-y-1">
          <h2 className="px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Queues</h2>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground hover:bg-white/5 h-10"
            data-testid="link-main-queue"
            onClick={() => onOpenAdvanced("queues")}
          >
            <div className="w-2 h-2 rounded-full bg-green-500" />
            Main Queue
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground hover:bg-white/5 h-10"
            data-testid="link-scheduled-queue"
            onClick={() => onOpenAdvanced("queues")}
          >
            <div className="w-2 h-2 rounded-full bg-yellow-500" />
            Scheduled
          </Button>
        </div>
      </div>

      <div className="p-4 border-t border-border bg-secondary/10">
        <div className="flex items-center gap-2 mb-2 text-sm font-medium text-muted-foreground">
          <HardDrive className="w-4 h-4" />
          <span>Storage</span>
        </div>
        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden mb-1">
          <div className="h-full bg-gradient-to-r from-primary to-purple-500 w-[75%]" />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
          <span>750 GB Used</span>
          <span>1 TB Total</span>
        </div>
      </div>
    </div>
  );
}

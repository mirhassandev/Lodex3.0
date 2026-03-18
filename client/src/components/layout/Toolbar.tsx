import React from "react";
import { Plus, Play, Pause, Square, Trash2, Layers, Search, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface ToolbarProps {
  onAddClick: () => void;
  onSearchChange: (value: string) => void;
  onAdvancedClick: () => void;
  onPlayAll?: () => void;
  onPauseAll?: () => void;
  onStopAll?: () => void;
  onDeleteSelected?: () => void;
}

export function Toolbar({ 
  onAddClick, 
  onSearchChange, 
  onAdvancedClick,
  onPlayAll,
  onPauseAll,
  onStopAll,
  onDeleteSelected
}: ToolbarProps) {
  return (
    <div className="h-14 flex items-center px-4 bg-background/60 backdrop-blur-xl border-b border-white/5 gap-4">
      {/* Left Section */}
      <div className="flex items-center gap-2">
        <Button 
          onClick={onAddClick}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold h-9 px-4 gap-2 rounded-lg transition-all active:scale-95"
        >
          <Plus className="w-4 h-4" />
          <span className="text-sm">Add URL</span>
        </Button>
        
        <div className="h-6 w-px bg-white/10 mx-1" />
        
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="w-9 h-9 text-white/40 hover:text-white" onClick={onPlayAll}>
            <Play className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="w-9 h-9 text-white/40 hover:text-white" onClick={onPauseAll}>
            <Pause className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="w-9 h-9 text-white/40 hover:text-white" onClick={onStopAll}>
            <Square className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="w-9 h-9 text-red-500/40 hover:text-red-500" onClick={onDeleteSelected}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
        
        <div className="h-6 w-px bg-white/10 mx-1" />
        
        <Button variant="ghost" className="h-9 px-3 gap-2 text-white/40 hover:text-white" onClick={onAdvancedClick}>
          <Layers className="w-4 h-4" />
          <span className="text-xs font-semibold uppercase tracking-wider">Advanced</span>
        </Button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right Section */}
      <div className="flex items-center gap-3">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
          <Input 
            placeholder="Search downloads..." 
            className="bg-white/5 border-white/5 pl-9 h-9 text-sm focus:ring-primary/20 rounded-lg"
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        
        <Button variant="ghost" size="icon" className="w-9 h-9 text-white/40 hover:text-white">
          <Settings className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

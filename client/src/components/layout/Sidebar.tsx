import React from "react";
import { Download, MonitorPlay, Music, FileText, Archive, Layers, HardDrive, Calendar, ShieldCheck, Zap, Globe, Lock, ArrowDownToLine, MousePointer2, Cpu, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FileType } from "@/lib/mock-data";



interface SidebarProps {
  activeFilter: string;
  onFilterChange: (filter: any) => void;
  onOpenAdvanced: (tab?: string) => void;
}

export function Sidebar({ activeFilter, onFilterChange, onOpenAdvanced }: SidebarProps) {
  const [diskInfo, setDiskInfo] = React.useState({ used: 0, total: 0, percent: 0, drive: 'C' });
  const [queues, setQueues] = React.useState<any[]>([]);
  const [showAddQueue, setShowAddQueue] = React.useState(false);
  const [newQueueName, setNewQueueName] = React.useState("");

  React.useEffect(() => {
    const fetchDiskInfo = async () => {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.getDiskInfo) {
        const info = await electronAPI.getDiskInfo();
        if (info && info.total > 0) {
          setDiskInfo(info);
        }
      }
    };

    fetchDiskInfo();
    const interval = setInterval(fetchDiskInfo, 60000); // Update every minute
    return () => clearInterval(interval);
  }, []);

  const fetchQueues = async () => {
    try {
      const res = await fetch('/api/queues');
      if (res.ok) setQueues(await res.json());
    } catch (e) {}
  };

  React.useEffect(() => {
    fetchQueues();
    const interval = setInterval(fetchQueues, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleAddQueue = async () => {
    if (!newQueueName) return;
    try {
      const res = await fetch('/api/queues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newQueueName })
      });
      if (res.ok) {
        fetchQueues();
        setNewQueueName("");
        setShowAddQueue(false);
      }
    } catch (e) {}
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const categories = [
    { id: "all", label: "All Downloads", icon: Layers },
    { id: "video", label: "Video", icon: MonitorPlay },
    { id: "audio", label: "Music", icon: Music },
    { id: "archive", label: "Compressed", icon: Archive },
    { id: "document", label: "Documents", icon: FileText },
    { id: "program", label: "Programs", icon: Cpu },
  ];

  return (
    <div className="w-64 border-r border-border bg-card/30 flex flex-col h-full backdrop-blur-md relative group">
      {/* Main Window Controls - Unified Style */}


      <div className="flex-1 overflow-y-auto pt-4 px-3">
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
        </div>

        <div className="mt-8 space-y-1">
          <div className="flex items-center justify-between px-4 mb-2">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Queues</h2>
            <Button 
                variant="ghost" 
                size="icon" 
                className="w-5 h-5 text-primary hover:bg-primary/10 rounded-full"
                onClick={() => setShowAddQueue(true)}
                title="Add New Queue"
            >
                <Plus className="w-3 h-3" />
            </Button>
          </div>

          <Dialog open={showAddQueue} onOpenChange={setShowAddQueue}>
            <DialogContent className="sm:max-w-md bg-slate-900/95 backdrop-blur-xl border-white/5 text-foreground shadow-2xl">
              <DialogHeader>
                <DialogTitle className="text-xl font-bold">New Queue</DialogTitle>
                <DialogDescription className="text-white/40">Create a new category to organize your transfers.</DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <Input 
                  value={newQueueName}
                  onChange={(e) => setNewQueueName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddQueue()}
                  placeholder="e.g. Work, Movies, Linux ISOs..."
                  className="bg-white/5 border-white/10 h-12 focus:ring-primary/40 rounded-xl"
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setShowAddQueue(false)}>Cancel</Button>
                <Button onClick={handleAddQueue} className="bg-primary hover:bg-primary/90 font-bold px-6">Create Queue</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          
          {queues.map((q) => {
            const filterId = `queue-${q.id}`;
            const isActive = activeFilter === filterId;
            return (
              <Button
                key={q.id}
                variant={isActive ? "secondary" : "ghost"}
                className={cn(
                  "w-full justify-start gap-3 h-10 transition-all duration-200",
                  isActive
                    ? "bg-primary/10 text-primary hover:bg-primary/15 font-medium border border-primary/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                )}
                onClick={() => onFilterChange(filterId)}
              >
                <div className={cn(
                    "w-2 h-2 rounded-full", 
                    q.id === 1 ? "bg-green-500/40" : "bg-primary/40",
                    isActive && (q.id === 1 ? "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]" : "bg-primary shadow-[0_0_8px_rgba(var(--primary),0.5)]")
                )} />
                {q.name}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="p-4 border-t border-border bg-secondary/10">
        <div className="flex items-center gap-2 mb-2 text-sm font-medium text-muted-foreground">
          <HardDrive className="w-4 h-4" />
          <span>Storage ({diskInfo.drive}:)</span>
        </div>
        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden mb-1">
          <div 
            className="h-full bg-gradient-to-r from-primary to-purple-500 transition-all duration-1000" 
            style={{ width: `${diskInfo.percent}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
          <span>{formatSize(diskInfo.used)} Used</span>
          <span>{formatSize(diskInfo.total)} Total</span>
        </div>
      </div>
    </div>
  );
}

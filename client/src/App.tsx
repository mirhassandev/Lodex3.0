import React, { useState, useEffect } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { TitleBar } from "@/components/layout/TitleBar";
import { Toaster } from "@/components/ui/toaster";
import { DownloadList } from "@/components/layout/DownloadList";
import { QueueDashboard } from "@/components/layout/QueueDashboard";
import { Toolbar } from "@/components/layout/Toolbar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Settings as SettingsIcon, Link2, Monitor, Globe, Shield, Zap, Trash2, Layers } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

function App() {
  const [activeFilter, setActiveFilter] = useState<any>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [url, setUrl] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const { toast } = useToast();

  const fetchTasks = async () => {
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.getDownloads) {
        const data = await electronAPI.getDownloads();
        setTasks(data);
      }
    } catch (e) {}
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleAddDownload = async () => {
    if (!url) return;
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.triggerDownload) {
        const res = await electronAPI.triggerDownload(url);
        if (res.ok) {
          toast({
            title: "Download Started",
            description: `Engine specialized for: ${res.task.engine.toUpperCase()}`,
          });
          setUrl("");
          setShowAddModal(false);
        } else {
          toast({
            title: "Transfer Failed",
            description: res.error,
            variant: "destructive",
          });
        }
      }
    } catch (e: any) {
      toast({
        title: "IPC Error",
        description: e.message,
        variant: "destructive",
      });
    }
  };

  const handleDeleteConfirm = async (deleteFile: boolean) => {
    if (!taskToDelete) return;
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.deleteDownload) {
        await electronAPI.deleteDownload(taskToDelete.id, deleteFile);
        toast({ 
          title: deleteFile ? "Permanently Deleted" : "Removed from List", 
          description: deleteFile ? `File and record for ${taskToDelete.filename} removed.` : `Record for ${taskToDelete.filename} removed.`
        });
        fetchTasks();
      }
    } catch (e) {}
    setShowDeleteDialog(false);
    setTaskToDelete(null);
  };

  const handleStopAll = async () => {
    const activeTasks = tasks.filter(t => t.status === 'downloading');
    if (activeTasks.length === 0) return;
    
    const electronAPI = (window as any).electronAPI;
    for (const t of activeTasks) {
       await electronAPI?.cancelDownload(t.id);
    }
    toast({ title: "Stopped", description: `Stopped ${activeTasks.length} active transfers.` });
    fetchTasks();
  };

  const handlePauseAll = async () => {
    toast({ title: "Pause", description: "Batch pause not yet supported by engine." });
  };

  const handlePlayAll = async () => {
    toast({ title: "Resume", description: "Batch resume not yet supported by engine." });
  };

  const handleDeleteAll = async () => {
    const deletable = tasks.filter(t => t.status === 'completed' || t.status === 'error');
    if (deletable.length === 0) return;

    const electronAPI = (window as any).electronAPI;
    for (const t of deletable) {
       await electronAPI?.deleteDownload(t.id);
    }
    toast({ title: "Cleaned Up", description: `Removed ${deletable.length} records.` });
    fetchTasks();
  };

  const getBreadcrumb = () => {
     if (activeFilter === 'all') return 'All Downloads';
     if (activeFilter.startsWith('queue-')) return 'Queue';
     return activeFilter.charAt(0).toUpperCase() + activeFilter.slice(1);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden text-foreground bg-background font-sans">
      <Sidebar
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        onOpenAdvanced={() => {}}
      />

      <main className="flex-1 flex flex-col min-w-0 bg-slate-950/20">
        <TitleBar breadcrumb={getBreadcrumb()} />
        
        <Toolbar 
          onAddClick={() => setShowAddModal(true)}
          onSearchChange={setSearchQuery}
          onAdvancedClick={() => setShowSettings(true)}
          onPlayAll={handlePlayAll}
          onPauseAll={handlePauseAll}
          onStopAll={handleStopAll}
          onDeleteSelected={handleDeleteAll}
        />

        <QueueDashboard
           tasks={tasks} 
           activeFilter={activeFilter}
           searchQuery={searchQuery}
           onTaskUpdate={fetchTasks}
           onDeleteTask={(task) => {
              setTaskToDelete(task);
              setShowDeleteDialog(true);
           }}
        />
      </main>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="sm:max-w-md bg-slate-900/95 backdrop-blur-xl border-white/5 text-foreground shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
               <Trash2 className="w-5 h-5 text-red-500" />
               Delete Transfer
            </DialogTitle>
            <DialogDescription className="text-white/60">
              How would you like to remove <strong>{taskToDelete?.filename}</strong>?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <Button 
                variant="outline" 
                className="justify-start h-14 border-white/5 hover:bg-white/5 gap-3"
                onClick={() => handleDeleteConfirm(false)}
            >
                <Layers className="w-5 h-5 text-blue-400" />
                <div className="flex flex-col items-start px-2">
                  <span className="font-semibold">Remove from List Only</span>
                  <span className="text-[10px] text-white/40">Keeps the downloaded file on your computer</span>
                </div>
            </Button>
            <Button 
                variant="outline" 
                className="justify-start h-14 border-red-500/20 hover:bg-red-500/10 hover:border-red-500/40 gap-3 group"
                onClick={() => handleDeleteConfirm(true)}
            >
                <Trash2 className="w-5 h-5 text-red-500" />
                <div className="flex flex-col items-start px-2">
                  <span className="font-semibold text-red-500">Delete Permanently</span>
                  <span className="text-[10px] text-red-500/40 group-hover:text-red-500/60">Removes the file from your disk forever</span>
                </div>
            </Button>
          </div>
          <DialogFooter className="sm:justify-start">
            <Button variant="ghost" onClick={() => setShowDeleteDialog(false)} className="text-white/40">Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add URL Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="sm:max-w-[500px] bg-slate-900/95 backdrop-blur-xl border-white/5 text-foreground shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Link2 className="w-5 h-5 text-primary" />
              New Download
            </DialogTitle>
            <DialogDescription className="text-white/40">
              Paste a video URL, magnet link, or a direct file path to begin.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-6">
            <div className="relative group">
              <Input 
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddDownload()}
                placeholder="https://..." 
                className="bg-white/5 border-white/10 h-14 pl-4 text-sm focus:ring-primary/40 focus:border-primary/40 rounded-xl transition-all"
                autoFocus
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowAddModal(false)} className="h-11 px-6 font-medium text-white/40 hover:text-white">
              Cancel
            </Button>
            <Button 
                onClick={handleAddDownload}
                className="h-11 px-8 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-lg shadow-primary/20 transition-all active:scale-95"
            >
                Start Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Modal */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="sm:max-w-[700px] bg-slate-950/95 backdrop-blur-2xl border-white/5 text-white shadow-2xl overflow-hidden p-0">
          <div className="flex h-[500px]">
            {/* Sidebar-ish Tabs */}
            <div className="w-48 border-r border-white/5 bg-black/20 p-4">
              <h2 className="text-xs font-bold uppercase tracking-widest text-primary mb-6 px-2">Settings</h2>
              <div className="space-y-1">
                <Button variant="ghost" className="w-full justify-start gap-3 h-10 bg-primary/10 text-primary">
                  <Monitor className="w-4 h-4" /> General
                </Button>
                <Button variant="ghost" className="w-full justify-start gap-3 h-10 text-white/40 hover:text-white">
                  <Globe className="w-4 h-4" /> Connection
                </Button>
                <Button variant="ghost" className="w-full justify-start gap-3 h-10 text-white/40 hover:text-white">
                  <Shield className="w-4 h-4" /> Privacy
                </Button>
                <Button variant="ghost" className="w-full justify-start gap-3 h-10 text-white/40 hover:text-white">
                  <Zap className="w-4 h-4" /> Advanced
                </Button>
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 p-8 overflow-y-auto">
                <h3 className="text-lg font-bold mb-6">General Preferences</h3>
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium">Dark Mode</p>
                            <p className="text-xs text-white/40">Use premium dark theme</p>
                        </div>
                        <div className="w-10 h-5 bg-primary rounded-full relative">
                            <div className="absolute right-1 top-1 w-3 h-3 bg-white rounded-full" />
                        </div>
                    </div>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium">Start with Windows</p>
                            <p className="text-xs text-white/40">Launch app on system startup</p>
                        </div>
                        <div className="w-10 h-5 bg-white/10 rounded-full relative" />
                    </div>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium">Limit bandwidth</p>
                            <p className="text-xs text-white/40">Prevent network congestion</p>
                        </div>
                        <div className="w-10 h-5 bg-white/10 rounded-full relative" />
                    </div>
                </div>
                
                <div className="mt-12 pt-8 border-t border-white/5 flex justify-end gap-3">
                   <Button variant="ghost" onClick={() => setShowSettings(false)}>Cancel</Button>
                   <Button onClick={() => setShowSettings(false)}>Save Changes</Button>
                </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Toaster />
    </div>
  );
}

export default App;

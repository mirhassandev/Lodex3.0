import React, { useState, useEffect } from "react";
import { 
  ArrowUp, ArrowDown, Trash2, Zap, 
  Clock, Download, Layers, Shield, 
  Settings, Play, Pause, X, ExternalLink
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface QueueDashboardProps {
  tasks: any[];
  activeFilter: string;
  searchQuery: string;
  onTaskUpdate: () => void;
  onDeleteTask: (task: any) => void;
}

export function QueueDashboard({ tasks, activeFilter, searchQuery, onTaskUpdate, onDeleteTask }: QueueDashboardProps) {
  const [maxConcurrent, setMaxConcurrent] = useState(4);
  const electronAPI = (window as any).electronAPI;

  const handleConcurrencyChange = async (val: string) => {
    const limit = parseInt(val) || 1;
    setMaxConcurrent(limit);
    if (electronAPI?.setConcurrency) {
      await electronAPI.setConcurrency(limit);
    }
  };

  const moveUp = async (id: number) => {
    if (electronAPI?.moveUp) {
      await electronAPI.moveUp(id);
      onTaskUpdate();
    }
  };

  const moveDown = async (id: number) => {
    if (electronAPI?.moveDown) {
      await electronAPI.moveDown(id);
      onTaskUpdate();
    }
  };

  // Filter and Sort
  const filteredTasks = tasks.filter(task => {
    const matchesFilter = activeFilter === "all" || task.status === activeFilter;
    const matchesSearch = task.filename.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const sortedTasks = [...filteredTasks].sort((a, b) => (a.priority || 0) - (b.priority || 0));

  return (
    <div className="flex flex-col h-full space-y-4 p-2 animate-in fade-in duration-500">
      {/* Header with Concurrency Control */}
      <div className="flex items-center justify-between p-4 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/20 rounded-lg">
             <Layers className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white/90">Parallel Processing</h2>
            <p className="text-[10px] text-white/40">Optimize throughput with concurrent slots</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 px-4 py-2 bg-black/40 border border-white/5 rounded-xl">
             <span className="text-[10px] font-mono text-white/40 uppercase tracking-tighter">Limit</span>
             <Input 
                type="number" 
                min="1" 
                max="32"
                value={maxConcurrent}
                onChange={(e) => handleConcurrencyChange(e.target.value)}
                className="w-16 h-8 bg-transparent border-none text-blue-400 font-bold text-lg focus-visible:ring-0 p-0 text-center"
             />
          </div>
        </div>
      </div>

      {/* Modern Queue Grid */}
      <div className="flex-1 overflow-hidden border border-white/5 bg-white/[0.02] rounded-3xl backdrop-blur-3xl shadow-inner">
        <div className="h-full overflow-y-auto custom-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/5 sticky top-0 z-10">
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-white/30 border-b border-white/5">Order</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-white/30 border-b border-white/5">File Name</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-white/30 border-b border-white/5">Status</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-white/30 border-b border-white/5 text-right">Speed</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-white/30 border-b border-white/5 text-right">ETA</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-white/30 border-b border-white/5 text-right">Size</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-white/30 border-b border-white/5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {sortedTasks.map((task, index) => {
                const isDownloading = task.status === 'downloading';
                const isCompleted = task.status === 'completed';
                const isActiveSlot = index < maxConcurrent && task.status === 'pending';

                return (
                  <tr key={task.id} className={cn(
                    "group transition-all hover:bg-white/[0.04]",
                    isDownloading && "bg-blue-500/[0.03]"
                  )}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                         <span className="text-xs font-mono text-white/20">#{index + 1}</span>
                         <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => moveUp(task.id)} className="p-1 hover:text-blue-400 text-white/20"><ArrowUp className="w-3 h-3" /></button>
                            <button onClick={() => moveDown(task.id)} className="p-1 hover:text-blue-400 text-white/20"><ArrowDown className="w-3 h-3" /></button>
                         </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 min-w-[240px]">
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-white/80 truncate max-w-[300px]">{task.filename}</span>
                        <span className="text-[10px] text-white/30 truncate max-w-[300px] font-mono">{task.url}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 min-w-[200px]">
                      <div className="flex flex-col gap-2">
                        <div className="flex justify-between items-center text-[10px]">
                           <Badge variant="outline" className={cn(
                             "px-2 py-0 border-none",
                             task.status === 'downloading' ? "text-blue-400 bg-blue-400/10" : 
                             task.status === 'completed' ? "text-green-400 bg-green-400/10" : "text-white/40 bg-white/5"
                           )}>
                             {task.status}
                           </Badge>
                           {isDownloading && <span className="text-blue-400 font-bold">{task.speed}</span>}
                        </div>
                        <Progress value={task.percentage} className="h-1 bg-white/5" />
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                       <span className={cn("text-xs font-mono", isDownloading ? "text-blue-400 font-bold" : "text-white/40")}>
                          {task.speed || '0 B/s'}
                       </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                       <div className="flex flex-col items-end">
                          <span className={cn("text-xs font-mono", isDownloading ? "text-blue-400 font-bold" : "text-white/40")}>
                             {task.eta || '--'}
                          </span>
                       </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                       <span className="text-xs font-mono text-white/60">{task.totalSize}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button 
                           variant="ghost" 
                           size="icon" 
                           onClick={() => onDeleteTask(task)} 
                           className="w-8 h-8 rounded-xl hover:bg-red-500/20 text-red-500/60 hover:text-red-500 transition-colors"
                        >
                           <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sortedTasks.length === 0 && (
            <div className="flex flex-col items-center justify-center p-20 text-white/20 italic">
               <Zap className="w-12 h-12 mb-4 opacity-10" />
               <p>No active tasks in queue</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

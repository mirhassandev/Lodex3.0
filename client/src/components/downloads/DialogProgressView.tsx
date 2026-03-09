import React from "react";
import { DownloadItem } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { 
    X, Pause, Play, FolderOpen, 
    MonitorPlay, Zap, Clock, Info, CheckCircle2, RotateCw 
} from "lucide-react";
import { motion } from "framer-motion";
import { formatBytes } from "@/lib/formatters";

interface DialogProgressViewProps {
  download: DownloadItem;
  onClose: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}

export function DialogProgressView({ download, onClose, onPause, onResume, onCancel }: DialogProgressViewProps) {
  const electronAPI = (window as any).electronAPI;

  const handleOpenFolder = () => {
    if (download.outPath && electronAPI?.openFolder) {
      electronAPI.openFolder(download.outPath);
      onClose();
    }
  };

  const handleOpenFile = () => {
    if (download.outPath && electronAPI?.openFile) {
      electronAPI.openFile(download.outPath);
      onClose();
    }
  };

  const isComplete = download.status === "completed";
  const isFailed = download.status === "error";
  const isPaused = download.status === "paused";

  return (
    <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-[#0b0f1a] w-full h-full rounded-2xl overflow-hidden border border-white/10 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.7)] flex flex-col"
    >
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div 
            style={{ WebkitAppRegion: 'drag' } as any}
            className="h-10 flex items-center px-4 relative shrink-0 border-b border-white/5 bg-[#0d1321]"
        >
            {/* macOS Window Controls */}
            <div className="flex gap-2 mr-6" style={{ WebkitAppRegion: 'no-drag' } as any}>
                <button onClick={onClose} className="w-2.5 h-2.5 rounded-full bg-[#ff5f57] hover:brightness-110 transition-all shadow-lg border border-black/10" />
                <button onClick={() => electronAPI?.minimize?.()} className="w-2.5 h-2.5 rounded-full bg-[#febc2e] hover:brightness-110 transition-all shadow-lg border border-black/10" />
                <button className="w-2.5 h-2.5 rounded-full bg-[#28c840] hover:brightness-110 transition-all shadow-lg border border-black/10 opacity-30 cursor-not-allowed" />
            </div>
            
            <div className="flex items-center gap-2">
                <MonitorPlay className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-[10px] font-black tracking-widest text-white/40 uppercase">Download Progress</span>
            </div>
        </div>

        {/* ── Main Content ────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {/* File Identity */}
            <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3 relative overflow-hidden group shadow-lg">
                <div className="flex gap-3 relative z-10">
                    <div className="w-14 h-14 bg-black/40 rounded border border-white/5 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform duration-500 shadow-inner">
                        <MonitorPlay className="w-6 h-6 text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-white font-black text-sm leading-tight truncate mb-1">{download.name}</h3>
                        <div className="flex flex-wrap gap-2 text-[9px] text-white/40 font-bold uppercase tracking-tight">
                            <span className="flex items-center gap-1">
                                <Info className="w-2.5 h-2.5 text-blue-400" /> 
                                {download.totalBytes ? formatBytes(download.totalBytes) : download.size || "Calculating..."}
                            </span>
                            <span className="flex items-center gap-1">
                                <Clock className="w-2.5 h-2.5 text-blue-400" /> 
                                {download.status === 'queued' ? 'In Queue' : download.status}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Progress Visual */}
            <div className="space-y-2">
                <div className="flex justify-between items-end">
                    <span className="text-[9px] font-black uppercase tracking-widest text-blue-400/80">Transfer Progress</span>
                    <span className="text-lg font-black text-white tabular-nums tracking-tighter">
                        {Math.floor(download.progress || 0)}<span className="text-[10px] text-white/40 ml-0.5">%</span>
                    </span>
                </div>
                <div className="h-1.5 bg-black/40 rounded-full border border-white/5 p-0.5 relative shadow-inner overflow-hidden">
                    <Progress value={download.progress} className="h-full bg-blue-500 transition-all duration-300 shadow-[0_0_10px_rgba(59,130,246,0.3)]" />
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-2">
                {[
                    { label: "Transfer Rate", value: download.speed, icon: Zap },
                    { label: "Remaining", value: download.eta, icon: Clock },
                    { label: "Downloaded", value: download.downloadedBytes ? formatBytes(download.downloadedBytes) : "0 B", icon: MonitorPlay },
                    { label: "Nodes", value: download.connections || 8, icon: Info },
                ].map((stat, i) => (
                    <div key={i} className="bg-white/[0.02] border border-white/5 p-2 rounded-lg group hover:border-blue-500/10 transition-all">
                        <p className="text-[8px] font-black text-white/20 uppercase tracking-[0.2em] mb-1 flex items-center gap-1.5">
                            <stat.icon className="w-2 h-2" /> {stat.label}
                        </p>
                        <p className="text-white font-bold text-xs tabular-nums truncate">{stat.value}</p>
                    </div>
                ))}
            </div>
        </div>

        {/* ── Action Footer ─────────────────────────────────────────────────── */}
        <div className="p-4 bg-[#0f172a] border-t border-white/5 flex gap-3 shrink-0 shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
            {isComplete ? (
                <>
                    <Button 
                        className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold h-9 rounded-lg gap-2 shadow-lg transition-all active:scale-[0.98] text-[11px]"
                        onClick={handleOpenFile}
                    >
                        <Zap className="w-3.5 h-3.5 fill-white/10" />
                        OPEN FILE
                    </Button>
                    <Button 
                        variant="secondary"
                        className="flex-1 bg-white/[0.03] hover:bg-white/[0.06] text-white/60 hover:text-white font-bold h-9 rounded-lg gap-2 border border-white/5 transition-all active:scale-[0.98] text-[11px]"
                        onClick={handleOpenFolder}
                    >
                        <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
                        FOLDER
                    </Button>
                </>
            ) : (
                <>
                    {isPaused ? (
                        <Button 
                            className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold h-9 rounded-lg gap-2 shadow-lg transition-all active:scale-[0.98] text-[11px]"
                            onClick={onResume}
                        >
                            <Play className="w-3.5 h-3.5 fill-white/10" />
                            RESUME
                        </Button>
                    ) : (
                        <Button 
                            className="flex-1 bg-white/10 hover:bg-white/15 text-white font-bold h-9 rounded-lg gap-2 shadow-lg transition-all active:scale-[0.98] text-[11px]"
                            onClick={onPause}
                        >
                            <Pause className="w-3.5 h-3.5 fill-white/10" />
                            PAUSE
                        </Button>
                    )}
                    <Button 
                        variant="destructive"
                        className="flex-1 bg-red-600/10 hover:bg-red-600/20 text-red-500 font-bold h-9 rounded-lg gap-2 border border-red-500/20 transition-all active:scale-[0.98] text-[11px]"
                        onClick={onCancel}
                    >
                        <X className="w-3.5 h-3.5" />
                        CANCEL
                    </Button>
                </>
            )}
        </div>
    </motion.div>
  );
}

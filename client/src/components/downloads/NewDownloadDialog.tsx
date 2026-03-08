import React, { useState, useEffect, useRef } from "react";
import { Download, X, FolderOpen, Zap, Clock, Loader2, Music, Film, List, Link, Check, ChevronDown, Info, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { motion, useDragControls } from "framer-motion";
import { toast } from "sonner";

interface QualityOption {
    formatId?: string;
    quality?: string;
    label: string;
    url?: string;
    filesize?: number;
    height?: number;
    type?: string;
    ext?: string;
}

interface MediaAnalysis {
    ok?: boolean;
    source?: string;
    title?: string;
    thumbnail?: string;
    uploader?: string;
    duration?: number;
    durationFormatted?: string;
    isLive?: boolean;
    isPlaylist?: boolean;
    playlistCount?: number;
    qualities?: QualityOption[];
    audio?: QualityOption[];
    isYouTube?: boolean;
    error?: string;
}

interface NewDownloadDialogProps {
    url: string;
    filename?: string;
    size?: number;
    headers?: Record<string, string>;
    meta?: any;
    onConfirm: (options: any) => void;
    onCancel: () => void;
}

function formatFileSize(bytes?: number): string {
    if (!bytes || bytes === 0) return "Unknown";
    const kb = bytes / 1024;
    const mb = kb / 1024;
    const gb = mb / 1024;
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    return `${kb.toFixed(0)} KB`;
}

export function NewDownloadDialog({ url, filename: initialFilename, size, headers, meta, onConfirm, onCancel }: NewDownloadDialogProps) {
    const [filename, setFilename] = useState(initialFilename || "downloaded_file");
    const [savePath, setSavePath] = useState("C:\\Users\\themi\\Downloads");
    const [isSpeedBoost, setIsSpeedBoost] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [analyzeError, setAnalyzeError] = useState<string | null>(null);
    const [media, setMedia] = useState<MediaAnalysis | null>(null);
    const [selectedQualityId, setSelectedQualityId] = useState<string>("");
    const [isAudioOnly, setIsAudioOnly] = useState(!!meta?.isAudioOnly);
    const [scheduledAt, setScheduledAt] = useState<string>('');
    const [copied, setCopied] = useState(false);

    const dragControls = useDragControls();
    const electronAPI = (window as any).electronAPI;
    const fileNameRef = useRef<HTMLInputElement>(null);

    const allQualities = media?.qualities || [];
    const audioOptions = media?.audio || [];
    const displayOptions = isAudioOnly ? audioOptions : allQualities;

    // ESC to close
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onCancel]);

    // Auto-focus filename
    useEffect(() => {
        if (!isLoading && fileNameRef.current) {
            fileNameRef.current.focus();
            fileNameRef.current.select();
        }
    }, [isLoading]);

    useEffect(() => {
        if (!url || !electronAPI?.analyzeMedia) return;
        setIsLoading(true);
        setAnalyzeError(null);

        electronAPI.analyzeMedia(url, meta || null, headers)
            .then((result: MediaAnalysis) => {
                if (!result.ok && result.error) {
                    setAnalyzeError(result.error);
                    return;
                }
                setMedia(result);

                if (result.title && result.title !== 'Unknown') {
                    const safeTitle = result.title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 80);
                    const rawExt = isAudioOnly ? 'mp3' : (result.qualities?.[0]?.ext || 'mp4');
                    const ext = rawExt.startsWith('.') ? rawExt : `.${rawExt}`;
                    setFilename(safeTitle + (safeTitle.toLowerCase().endsWith(ext.toLowerCase()) ? '' : ext));
                }

                const options = isAudioOnly ? result.audio : result.qualities;
                const best = options?.[0];
                if (best?.formatId || best?.quality) {
                    setSelectedQualityId(best.formatId || best.quality || '');
                }
            })
            .catch((e: any) => {
                setAnalyzeError(e?.message || 'Analysis failed');
            })
            .finally(() => setIsLoading(false));
    }, [url]);

    useEffect(() => {
        if (!filename || !media || (media.source === 'direct' && !media.isYouTube)) return;
        const base = filename.substring(0, filename.lastIndexOf('.')) || filename;
        const ext = isAudioOnly ? '.mp3' : '.mp4';
        if (!filename.endsWith(ext)) {
            setFilename(base + ext);
        }
    }, [isAudioOnly, media]);

    const copyUrl = () => {
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        toast.success("URL Copied to clipboard");
    };

    const pickFolder = async () => {
        if (electronAPI?.selectFolder) {
            const res = await electronAPI.selectFolder();
            if (res) setSavePath(res);
        } else {
            console.warn('[Dialog] selectFolder API not found');
        }
    };

    const selectedOption = displayOptions.find(
        q => (q.formatId || q.quality) === selectedQualityId
    ) || displayOptions[0];

    const handleConfirm = (mode: 'now' | 'later') => {
        onConfirm({
            filename,
            savePath,
            mode,
            priority: 'normal',
            scheduledAt: mode === 'later' ? scheduledAt : null,
            connections: isSpeedBoost ? 16 : 4,
            quality: selectedOption?.quality,
            formatId: selectedOption?.formatId,
            variantUrl: selectedOption?.url || url,
            type: media?.source || 'direct',
            isAudioOnly,
            status: mode === 'later' ? 'scheduled' : 'queued',
            headers: headers
        });
    };

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-[#0b0f1a] w-full h-full rounded-3xl overflow-hidden border border-white/10 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.7)] flex flex-col"
        >

                {/* ── Draggable Header ────────────────────────────────────────────────── */}
                <div 
                    style={{ WebkitAppRegion: 'drag' } as any}
                    className="bg-gradient-to-r from-[#1e293b] to-[#0f172a] p-6 border-b border-white/5 flex justify-between items-center relative shrink-0"
                >
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />
                    <div className="flex items-center gap-4">
                        <div className="bg-blue-600/20 p-3 rounded-2xl border border-blue-500/20 shadow-inner">
                            {isLoading
                                ? <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                                : <Download className="w-5 h-5 text-blue-400" />}
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-white leading-tight tracking-tight">New Download</h2>
                            <p className="text-[10px] text-blue-400 uppercase tracking-widest font-black opacity-70">Nexus Intelligence Engine</p>
                        </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onCancel}
                        style={{ WebkitAppRegion: 'no-drag' } as any}
                        className="text-muted-foreground hover:text-white hover:bg-white/5 rounded-2xl h-10 w-10 transition-all border border-transparent hover:border-white/10">
                        <X className="w-5 h-5" />
                    </Button>
                </div>

                {/* ── Main Scrollable Content ────────────────────────────────────────── */}
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    <div className="p-8 space-y-8">

                        {/* Top Section: Media Info + Source URL */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                            {/* Media Card */}
                            <div className="lg:col-span-12 flex gap-6 bg-white/[0.02] border border-white/5 rounded-[2rem] p-6 shadow-2xl relative overflow-hidden group hover:border-blue-500/20 transition-all">
                                <div className="absolute inset-0 bg-gradient-to-br from-blue-600/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                
                                {/* Thumbnail */}
                                <div className="w-48 h-28 bg-black/40 rounded-2xl flex-shrink-0 overflow-hidden flex items-center justify-center border border-white/5 shadow-inner">
                                    {media?.thumbnail
                                        ? <img src={media.thumbnail} alt="thumb" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                        : isLoading
                                            ? <Loader2 className="w-8 h-8 text-blue-400/40 animate-spin" />
                                            : <Film className="w-8 h-8 text-blue-400/20" />}
                                </div>

                                <div className="flex-1 flex flex-col justify-center gap-2 min-w-0">
                                    {isLoading ? (
                                        <div className="space-y-2">
                                            <div className="h-4 w-3/4 bg-white/5 rounded-lg animate-pulse" />
                                            <div className="h-3 w-1/2 bg-white/5 rounded-lg animate-pulse" />
                                        </div>
                                    ) : (
                                        <>
                                            <p className="text-white font-black text-lg leading-tight truncate">{media?.title || 'Resolving Media Title...'}</p>
                                            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground font-bold tracking-tight">
                                                {media?.uploader && <span className="flex items-center gap-1.5"><Info className="w-3 h-3 text-blue-400" /> {media.uploader}</span>}
                                                {media?.durationFormatted && <span className="flex items-center gap-1.5"><Clock className="w-3 h-3 text-blue-400" /> {media.durationFormatted}</span>}
                                                {media?.source && <span className="bg-blue-600/20 text-blue-400 px-2.5 py-1 rounded-lg text-[10px] uppercase font-black tracking-widest">{media.source}</span>}
                                                {media?.isLive && <span className="bg-red-600/20 text-red-400 px-2.5 py-1 rounded-lg text-[10px] uppercase font-black tracking-widest animate-pulse">● LIVE</span>}
                                            </div>
                                            {analyzeError && <p className="text-red-400/80 text-[10px] font-bold">⚠ {analyzeError}</p>}
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Source URL with Copy */}
                            <div className="lg:col-span-12 space-y-3">
                                <Label className="text-xs text-white/40 uppercase font-black tracking-[0.2em] flex items-center gap-2 ml-1">
                                    Source URL
                                </Label>
                                <div 
                                    onClick={copyUrl}
                                    className="group relative cursor-pointer bg-black/40 border border-white/5 hover:border-blue-500/30 text-xs text-blue-400/80 font-mono p-4 rounded-2xl shadow-inner transition-all flex items-center gap-4 overflow-hidden"
                                >
                                    <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    <Link className="w-4 h-4 shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" />
                                    <span className="flex-1 truncate leading-relaxed">{url}</span>
                                    {copied ? <Check className="w-4 h-4 text-green-400 shrink-0" /> : <div className="text-[10px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all">Copy</div>}
                                </div>
                            </div>
                        </div>

                        {/* Middle Section: Filename + Save Path */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            {/* File Name */}
                            <div className="space-y-3">
                                <Label className="text-xs text-white/40 uppercase font-black tracking-[0.2em] flex items-center gap-2 ml-1">
                                    File Name
                                </Label>
                                <Input
                                    ref={fileNameRef}
                                    value={filename}
                                    onChange={(e) => setFilename(e.target.value)}
                                    className="bg-white/5 border-white/10 h-14 px-6 rounded-2xl text-white font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all shadow-inner text-sm"
                                    placeholder="Enter file name..."
                                />
                            </div>

                            {/* Save Path */}
                            <div className="space-y-3">
                                <Label className="text-xs text-white/40 uppercase font-black tracking-[0.2em] flex items-center gap-2 ml-1">
                                    Save Destination
                                </Label>
                                <div className="flex gap-3">
                                    <Input
                                        value={savePath}
                                        onChange={(e) => setSavePath(e.target.value)}
                                        className="bg-white/5 border-white/10 h-14 flex-1 px-6 rounded-2xl text-white text-xs shadow-inner font-mono text-muted-foreground"
                                        readOnly
                                    />
                                    <Button 
                                        onClick={pickFolder}
                                        className="h-14 w-14 bg-blue-600/10 border border-blue-500/20 hover:bg-blue-600/20 rounded-2xl transition-all flex-shrink-0 group shadow-lg"
                                    >
                                        <FolderOpen className="w-6 h-6 text-blue-400 group-hover:scale-110 transition-transform" />
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {/* Optional Section: Advanced Settings Toggle */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-end">
                             {/* Turbo */}
                             <div className="flex items-center justify-between bg-white/[0.02] p-5 rounded-[1.5rem] border border-white/5 h-16 group hover:border-yellow-500/20 transition-all">
                                <div className="flex items-center gap-4">
                                    <div className={`p-2 rounded-xl transition-all ${isSpeedBoost ? 'bg-yellow-500/20 border border-yellow-500/30' : 'bg-white/5 border border-white/5'}`}>
                                        <Zap className={`w-4 h-4 ${isSpeedBoost ? 'text-yellow-500 fill-yellow-500/50' : 'text-muted-foreground'}`} />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className={`text-xs font-black uppercase tracking-widest ${isSpeedBoost ? 'text-white' : 'text-muted-foreground'}`}>Turbo Engine</span>
                                        <span className="text-[9px] text-muted-foreground font-bold">16 Parallel connections</span>
                                    </div>
                                </div>
                                <Switch checked={isSpeedBoost} onCheckedChange={setIsSpeedBoost} className="data-[state=checked]:bg-blue-600" />
                            </div>

                            {/* Schedule */}
                            <div className="space-y-3">
                                <Label className="text-xs text-white/40 uppercase font-black tracking-[0.2em] flex items-center gap-2 ml-1">
                                    Schedule Start
                                </Label>
                                <div className="relative">
                                    <Input
                                        type="datetime-local"
                                        value={scheduledAt}
                                        onChange={(e) => setScheduledAt(e.target.value)}
                                        className="bg-white/5 border-white/10 h-14 px-6 rounded-2xl text-white font-mono text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all [color-scheme:dark]"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Quality Selection: Modernized */}
                        {!media?.isPlaylist && (media?.source === 'ytdl' || media?.source === 'hls' || media?.source === 'dash' || media?.isYouTube) && (
                            <div className="space-y-6 pt-4 border-t border-white/5">
                                <div className="flex items-center justify-between mb-2">
                                    <Label className="text-xs text-white/40 uppercase font-black tracking-[0.2em] ml-1">Format & Quality</Label>
                                    <div className="flex bg-black/40 rounded-xl border border-white/5 p-1">
                                        <button 
                                            onClick={() => { setIsAudioOnly(false); setSelectedQualityId(''); }}
                                            className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${!isAudioOnly ? 'bg-blue-600 text-white shadow-lg' : 'text-muted-foreground hover:text-white'}`}
                                        >VIDEO</button>
                                        <button 
                                            onClick={() => { setIsAudioOnly(true); setSelectedQualityId(''); }}
                                            className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${isAudioOnly ? 'bg-purple-600 text-white shadow-lg' : 'text-muted-foreground hover:text-white'}`}
                                        >AUDIO</button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {isLoading ? (
                                        [1, 2, 4, 5].map(i => <div key={i} className="h-20 bg-white/5 rounded-3xl animate-pulse" />)
                                    ) : displayOptions.length > 0 ? (
                                        displayOptions.map((q, i) => {
                                            const qId = q.formatId || q.quality || String(i);
                                            const isSelected = selectedQualityId === qId || (!selectedQualityId && i === 0);
                                            return (
                                                <button
                                                    key={qId}
                                                    onClick={() => setSelectedQualityId(qId)}
                                                    className={`group relative flex items-center justify-between p-5 rounded-[1.5rem] border transition-all ${isSelected
                                                        ? isAudioOnly ? 'bg-purple-600/10 border-purple-500/40 text-white ring-2 ring-purple-500/10' : 'bg-blue-600/10 border-blue-500/40 text-white ring-2 ring-blue-500/10'
                                                        : 'bg-black/10 border-white/5 text-muted-foreground hover:border-white/10 hover:bg-white/[0.02]'
                                                        }`}
                                                >
                                                    <div className="flex items-center gap-4">
                                                        <div className={`w-8 h-8 rounded-xl border-2 flex items-center justify-center transition-all ${isSelected
                                                            ? isAudioOnly ? 'bg-purple-500 border-purple-400 rotate-0 scale-110' : 'bg-blue-500 border-blue-400 rotate-0 scale-110'
                                                            : 'border-white/10 rotate-12 group-hover:rotate-0'
                                                            }`}>
                                                                {isSelected ? <Check className="w-4 h-4 text-white" /> : (isAudioOnly ? <Music className="w-4 h-4" /> : <Film className="w-4 h-4" />)}
                                                        </div>
                                                        <div className="text-left">
                                                            <span className="font-black text-sm block leading-none mb-1">{q.label || q.quality}</span>
                                                            <div className="flex items-center gap-2 opacity-60">
                                                                {q.ext && <span className="text-[9px] uppercase font-black">{q.ext}</span>}
                                                                <span className="text-[9px] uppercase">•</span>
                                                                <span className="text-[9px] font-black">{q.filesize ? formatFileSize(q.filesize) : 'Unknown Size'}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {q.height && (
                                                        <span className={`px-2.5 py-1 rounded-lg font-black text-[10px] uppercase shadow-lg ${
                                                            q.height >= 2160 ? 'bg-yellow-500 text-black' :
                                                            q.height >= 1080 ? 'bg-blue-600 text-white' :
                                                            'bg-white/10 text-white'
                                                        }`}>
                                                            {q.height >= 2160 ? '4K UHD' : q.height >= 1080 ? 'Full HD' : q.height >= 720 ? 'HD' : q.height + 'P'}
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })
                                    ) : (
                                        <div className="col-span-full h-32 flex flex-col items-center justify-center rounded-3xl bg-black/20 border border-dashed border-white/10 gap-3 text-muted-foreground">
                                            <Radio className="w-6 h-6 opacity-20" />
                                            <p className="text-xs font-bold uppercase tracking-widest">{analyzeError ? 'Standard Stream' : 'Analyzing format options...'}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Playlist Summary */}
                        {media?.isPlaylist && (
                            <div className="bg-gradient-to-r from-yellow-500/10 to-transparent border border-yellow-500/20 rounded-3xl p-6 flex items-center gap-6 shadow-2xl">
                                <div className="bg-yellow-500/20 p-4 rounded-2xl border border-yellow-500/20">
                                    <List className="w-8 h-8 text-yellow-400" />
                                </div>
                                <div>
                                    <h4 className="text-yellow-400 text-lg font-black tracking-tight leading-none mb-1">Playlist Queue</h4>
                                    <p className="text-yellow-400/60 text-xs font-bold">{media.playlistCount} items will be processed sequentially</p>
                                </div>
                            </div>
                        )}

                    </div>
                </div>

                {/* ── Action Footer ─────────────────────────────────────────────────── */}
                <div className="p-8 bg-[#0f172a] border-t border-white/5 flex gap-6 shrink-0 shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
                    <Button
                        className="flex-[2] bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-black h-16 rounded-2xl gap-3 shadow-[0_10px_30px_rgba(37,99,235,0.4)] transition-all active:scale-[0.98] text-base group"
                        onClick={() => handleConfirm('now')}
                        disabled={isLoading}
                    >
                        {isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Zap className="w-6 h-6 fill-white/20 group-hover:scale-110 transition-transform" />}
                        {media?.isPlaylist ? `DOWNLOAD ENTIRE PLAYLIST (${media.playlistCount})` : 'DOWNLOAD NOW'}
                    </Button>
                    <Button
                        variant="secondary"
                        className="flex-1 bg-white/[0.03] hover:bg-white/[0.08] text-white font-black h-16 rounded-2xl gap-3 px-8 border border-white/10 transition-all active:scale-[0.98] text-sm group"
                        onClick={() => handleConfirm('later')}
                    >
                        <Clock className="w-5 h-5 opacity-40 group-hover:opacity-100 group-hover:scale-110 transition-all" />
                        LATER
                    </Button>
                </div>
        </motion.div>
    );
}

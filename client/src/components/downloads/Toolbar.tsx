import React, { useState } from "react";
import {
  Plus,
  Play,
  Pause,
  X,
  Trash2,
  Settings,
  Search,
  Filter,
  Download,
  Link2,
  Calendar,
  ShieldCheck,
  Zap,
  Globe,
  Lock,
  ArrowDownToLine,
  Layers
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

interface ToolbarProps {
  onAddDownload: (url: string, youtubeOptions?: { quality?: string, title?: string }) => void;
  onOpenAdvanced: (tab?: string) => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
  onCancelAll: () => void;
  onDeleteSelected: () => void;
  hasSelection: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function Toolbar({ onAddDownload, onOpenAdvanced, onPauseAll, onResumeAll, onCancelAll, onDeleteSelected, hasSelection, searchQuery, onSearchChange }: ToolbarProps) {
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [mediaType, setMediaType] = useState("video");
  const [isSpeedBoost, setIsSpeedBoost] = useState(true);
  const [antivirusEnabled, setAntivirusEnabled] = useState(true);

  // YouTube dynamic selection state
  const [ytResolutions, setYtResolutions] = useState<number[]>([]);
  const [ytTitle, setYtTitle] = useState("");
  const [ytSelectedQuality, setYtSelectedQuality] = useState("1080");
  const [isFetchingInfo, setIsFetchingInfo] = useState(false);

  const isYouTube = url.includes("youtube.com") || url.includes("youtu.be");

  React.useEffect(() => {
    if (isYouTube && isAddOpen) {
      const fetchInfo = async () => {
        const electronAPI = (window as any).electronAPI;
        if (!electronAPI?.getYoutubeInfo) return;

        setIsFetchingInfo(true);
        try {
          const res = await electronAPI.getYoutubeInfo(url);
          if (res.ok) {
            setYtResolutions(res.resolutions);
            setYtTitle(res.title);
            if (res.resolutions.length > 0) {
              setYtSelectedQuality(String(res.resolutions[0])); // Default to highest
            }
          }
        } catch (e) {
          console.error("Failed to fetch YouTube info:", e);
        } finally {
          setIsFetchingInfo(false);
        }
      };

      const timer = setTimeout(fetchInfo, 500); // Simple debounce
      return () => clearTimeout(timer);
    } else {
      setYtResolutions([]);
      setYtTitle("");
    }
  }, [url, isYouTube, isAddOpen]);

  const handleAdd = () => {
    if (isYouTube) {
      onAddDownload(url, { quality: ytSelectedQuality, title: ytTitle });
    } else {
      onAddDownload(url);
    }
    setIsAddOpen(false);
    setUrl("");
    setYtResolutions([]);
    setYtTitle("");
  };

  return (
    <div className="h-16 border-b border-border bg-card/50 backdrop-blur-xl flex items-center px-4 justify-between sticky top-0 z-10">
      <div className="flex items-center gap-2">
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-primary hover:bg-primary/90 text-white shadow-[0_0_15px_rgba(var(--primary),0.5)] border-none" data-testid="button-add-url">
              <Plus className="w-4 h-4" />
              Add URL
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px] bg-card border-border/50 backdrop-blur-3xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                <Link2 className="w-5 h-5 text-primary" />
                Add New Download
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-6 py-4">
              <div className="grid gap-2">
                <Label htmlFor="url" className="text-muted-foreground">Download URL / Magnet Link</Label>
                <div className="flex gap-2">
                  <Input
                    id="url"
                    placeholder="https://example.com/file.zip"
                    className="col-span-3 bg-secondary/50 border-white/5 focus:border-primary/50 transition-colors"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    data-testid="input-download-url"
                  />
                  <Button size="icon" variant="secondary" onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      setUrl(text);
                    } catch (e) { console.error("Clipboard access failed"); }
                  }} data-testid="button-paste-url">
                    <Download className="w-4 h-4" />
                  </Button>
                </div>
                {isFetchingInfo && <p className="text-[10px] text-primary animate-pulse">Fetching video info...</p>}
                {ytTitle && <p className="text-[11px] text-muted-foreground truncate italic">Title: {ytTitle}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-white/5">
                  <div className="flex items-center gap-2">
                    <Zap className={cn("w-4 h-4", isSpeedBoost ? "text-yellow-500" : "text-muted-foreground")} />
                    <span className="text-sm font-medium">Speed Boost</span>
                  </div>
                  <Switch checked={isSpeedBoost} onCheckedChange={setIsSpeedBoost} data-testid="switch-speed-boost" />
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-white/5">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className={cn("w-4 h-4", antivirusEnabled ? "text-green-500" : "text-muted-foreground")} />
                    <span className="text-sm font-medium">Antivirus</span>
                  </div>
                  <Switch checked={antivirusEnabled} onCheckedChange={setAntivirusEnabled} data-testid="switch-antivirus" />
                </div>
              </div>

              {isYouTube ? (
                <Tabs defaultValue="video" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 bg-secondary/50">
                    <TabsTrigger value="video">Video</TabsTrigger>
                    <TabsTrigger value="audio">Audio (MP3)</TabsTrigger>
                  </TabsList>
                  <TabsContent value="video" className="mt-4 space-y-4">
                    <div className="space-y-2">
                      <Label>Quality</Label>
                      <RadioGroup value={ytSelectedQuality} onValueChange={setYtSelectedQuality} className="grid grid-cols-3 gap-2">
                        {ytResolutions.length > 0 ? ytResolutions.map((res) => {
                          const label = res >= 2160 ? '4K' : res >= 1440 ? '1440p' : `${res}p`;
                          return (
                            <div key={res}>
                              <RadioGroupItem value={String(res)} id={`q-${res}`} className="peer sr-only" />
                              <Label
                                htmlFor={`q-${res}`}
                                className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-2 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:text-primary cursor-pointer transition-all text-xs"
                              >
                                {label}
                              </Label>
                            </div>
                          );
                        }) : (
                          ['4K', '1440p', '1080p', '720p', '480p', '360p'].map((q) => (
                            <div key={q} className="opacity-50 pointer-events-none">
                              <RadioGroupItem value={q} id={`q-${q}`} className="peer sr-only" />
                              <Label className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-2 text-xs">
                                {q}
                              </Label>
                            </div>
                          ))
                        )}
                      </RadioGroup>
                    </div>
                  </TabsContent>
                  <TabsContent value="audio" className="mt-4">
                    <div className="p-4 rounded-lg bg-secondary/30 border border-white/5">
                      <p className="text-sm text-muted-foreground">Audio will be extracted as MP3 (320kbps)</p>
                    </div>
                  </TabsContent>
                </Tabs>
              ) : null}
            </div>
            <DialogFooter>
              <Button onClick={handleAdd} disabled={isFetchingInfo} className="w-full bg-primary hover:bg-primary/90" data-testid="button-start-download">Start Download</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="w-px h-8 bg-border mx-2" />

        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" data-testid="button-resume-all" onClick={onResumeAll}>
          <Play className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" data-testid="button-pause-all" onClick={onPauseAll}>
          <Pause className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" data-testid="button-stop-all" onClick={onCancelAll}>
          <X className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "text-destructive hover:bg-destructive/10 hover:text-destructive",
            hasSelection && "bg-destructive/10 ring-1 ring-destructive/20 shadow-[0_0_10px_rgba(239,68,68,0.2)]"
          )}
          data-testid="button-delete-selected"
          onClick={onDeleteSelected}
        >
          <Trash2 className="w-4 h-4" />
        </Button>

        <div className="w-px h-8 bg-border mx-2" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" data-testid="button-advanced-tools">
              <Layers className="w-4 h-4" />
              Advanced
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56 bg-card border-border">
            <DropdownMenuLabel>Advanced Tools</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2" onClick={() => onOpenAdvanced("scheduler")}>
              <Calendar className="w-4 h-4" /> Scheduler
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2" onClick={() => onOpenAdvanced("browser")}>
              <Globe className="w-4 h-4" /> Browser Integration
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2" onClick={() => onOpenAdvanced("auth")}>
              <Lock className="w-4 h-4" /> Authentication (NTLM/Kerberos)
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2" onClick={() => onOpenAdvanced("proxy")}>
              <ArrowDownToLine className="w-4 h-4" /> Proxy Settings
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2" onClick={() => onOpenAdvanced("queues")}>
              <Layers className="w-4 h-4" /> Queue Management
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative w-64">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search downloads..."
            className="pl-8 bg-secondary/50 border-transparent focus:border-primary/50"
            data-testid="input-search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <Button variant="ghost" size="icon" data-testid="button-settings" onClick={() => onOpenAdvanced()}>
          <Settings className="w-5 h-5" />
        </Button>
      </div>
    </div>
  );
}

import { cn } from "@/lib/utils";

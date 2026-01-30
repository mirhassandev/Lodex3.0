import React, { useState } from "react";
import { 
  Calendar, 
  Globe, 
  ArrowDownToLine, 
  Clock, 
  Settings2, 
  Shield, 
  Zap, 
  Network,
  History,
  MousePointer2,
  Trash2,
  Play,
  Pause,
  AlertCircle,
  Lock,
  Server
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

interface AdvancedToolsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: string;
}

export function AdvancedToolsModal({ open, onOpenChange, initialTab = "scheduler" }: AdvancedToolsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] h-[600px] flex flex-col p-0 overflow-hidden bg-card border-border/50">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="text-2xl font-bold flex items-center gap-2">
            <Settings2 className="w-6 h-6 text-primary" />
            Advanced Management Tools
          </DialogTitle>
          <DialogDescription>
            Configure scheduling, network proxies, and browser automation settings.
          </DialogDescription>
        </DialogHeader>
        
        <Tabs defaultValue={initialTab} className="flex-1 flex flex-col min-h-0">
          <div className="px-6 border-b">
            <TabsList className="bg-transparent h-12 gap-6 p-0">
              <TabsTrigger value="scheduler" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 h-12 flex gap-2">
                <Calendar className="w-4 h-4" /> Scheduler
              </TabsTrigger>
              <TabsTrigger value="proxy" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 h-12 flex gap-2">
                <Network className="w-4 h-4" /> Proxy
              </TabsTrigger>
              <TabsTrigger value="browser" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 h-12 flex gap-2">
                <Globe className="w-4 h-4" /> Browser
              </TabsTrigger>
              <TabsTrigger value="auth" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 h-12 flex gap-2">
                <Lock className="w-4 h-4" /> Auth
              </TabsTrigger>
              <TabsTrigger value="queues" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 h-12 flex gap-2">
                <History className="w-4 h-4" /> Queues
              </TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-6">
              <TabsContent value="scheduler" className="mt-0 space-y-6">
                <div className="grid gap-4">
                  <div className="flex items-center justify-between p-4 rounded-xl border bg-secondary/20">
                    <div className="space-y-0.5">
                      <Label className="text-base">Enable Smart Scheduler</Label>
                      <p className="text-sm text-muted-foreground">Automatically pause/resume downloads based on your schedule.</p>
                    </div>
                    <Switch defaultChecked />
                  </div>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Clock className="w-4 h-4 text-primary" />
                        Daily Download Window
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Start Time</Label>
                          <Input type="time" defaultValue="00:00" />
                        </div>
                        <div className="space-y-2">
                          <Label>Stop Time</Label>
                          <Input type="time" defaultValue="06:00" />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-primary/5 p-3 rounded-lg border border-primary/10">
                        <AlertCircle className="w-4 h-4 text-primary" />
                        Downloads will only run between these hours to maximize off-peak bandwidth.
                      </div>
                    </CardContent>
                  </Card>

                  <div className="space-y-2">
                    <Label>Post-Download Actions</Label>
                    <Select defaultValue="nothing">
                      <SelectTrigger>
                        <SelectValue placeholder="Select action" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nothing">Do Nothing</SelectItem>
                        <SelectItem value="shutdown">Shutdown Computer</SelectItem>
                        <SelectItem value="sleep">Sleep Mode</SelectItem>
                        <SelectItem value="exit">Exit Nexus Manager</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="proxy" className="mt-0 space-y-6">
                <div className="grid gap-4">
                  <div className="flex items-center justify-between p-4 rounded-xl border bg-secondary/20">
                    <div className="space-y-0.5">
                      <Label className="text-base">Use Proxy Server</Label>
                      <p className="text-sm text-muted-foreground">Route downloads through a proxy for anonymity.</p>
                    </div>
                    <Switch />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2 space-y-2">
                      <Label>Proxy Address / URL</Label>
                      <Input placeholder="proxy.example.com" />
                    </div>
                    <div className="space-y-2">
                      <Label>Port</Label>
                      <Input placeholder="8080" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Proxy Type</Label>
                    <Select defaultValue="http">
                      <SelectTrigger>
                        <SelectValue placeholder="Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="http">HTTP</SelectItem>
                        <SelectItem value="https">HTTPS</SelectItem>
                        <SelectItem value="socks4">SOCKS4</SelectItem>
                        <SelectItem value="socks5">SOCKS5</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="p-4 rounded-xl border border-dashed border-primary/20 bg-primary/5">
                    <div className="flex items-center gap-3 mb-2">
                      <Shield className="w-5 h-5 text-primary" />
                      <h4 className="font-medium">Authentication</h4>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <Input placeholder="Username" />
                      <Input type="password" placeholder="Password" />
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="browser" className="mt-0 space-y-6">
                <div className="space-y-4">
                  <div className="p-4 rounded-xl border bg-secondary/10 flex items-start gap-4">
                    <div className="w-12 h-12 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0">
                      <Globe className="w-6 h-6 text-blue-500" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-bold mb-1">Nexus Web Extension</h4>
                      <p className="text-sm text-muted-foreground mb-3">Capture downloads directly from Chrome, Firefox, and Edge.</p>
                      <Button size="sm" variant="outline" className="gap-2">
                        Install Extension
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Integrated Browsers</h4>
                    {[
                      { name: "Google Chrome", version: "120.0.6099", status: "Enabled" },
                      { name: "Mozilla Firefox", version: "121.0", status: "Enabled" },
                      { name: "Microsoft Edge", version: "120.0.2210", status: "Disabled" },
                    ].map((browser) => (
                      <div key={browser.name} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                        <div className="flex flex-col">
                          <span className="font-medium">{browser.name}</span>
                          <span className="text-xs text-muted-foreground">Version {browser.version}</span>
                        </div>
                        <Switch defaultChecked={browser.status === "Enabled"} />
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="auth" className="mt-0 space-y-6">
                <div className="grid gap-4">
                  <div className="flex items-center justify-between p-4 rounded-xl border bg-secondary/20">
                    <div className="space-y-0.5">
                      <Label className="text-base">Enable Advanced Authentication</Label>
                      <p className="text-sm text-muted-foreground">Support for enterprise-grade authentication protocols.</p>
                    </div>
                    <Switch defaultChecked />
                  </div>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Server className="w-4 h-4 text-primary" />
                        Domain Authentication (NTLM / Kerberos)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-4">
                        <div className="space-y-2">
                          <Label>Active Directory Domain</Label>
                          <Input placeholder="CORP.EXAMPLE.COM" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Username</Label>
                            <Input placeholder="DOMAIN\user" />
                          </div>
                          <div className="space-y-2">
                            <Label>Password</Label>
                            <Input type="password" placeholder="••••••••" />
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/10">
                        <Lock className="w-4 h-4 text-primary shrink-0" />
                        <p className="text-xs text-muted-foreground">
                          Nexus Manager will automatically negotiate authentication for protected intranet servers and proxy gateways using your system credentials if "Single Sign-On" is enabled.
                        </p>
                      </div>

                      <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                        <div className="space-y-0.5">
                          <Label>Use System Credentials (SSO)</Label>
                          <p className="text-[10px] text-muted-foreground">Automatically log in using current Windows/macOS user session.</p>
                        </div>
                        <Switch defaultChecked />
                      </div>
                    </CardContent>
                  </Card>

                  <div className="space-y-2">
                    <Label>Preferred Protocol</Label>
                    <Select defaultValue="negotiate">
                      <SelectTrigger>
                        <SelectValue placeholder="Protocol" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="negotiate">Negotiate (Recommended)</SelectItem>
                        <SelectItem value="kerberos">Kerberos Only</SelectItem>
                        <SelectItem value="ntlm">NTLM v2 Only</SelectItem>
                        <SelectItem value="basic">Basic (Insecure)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="queues" className="mt-0 space-y-6">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="font-semibold">Active Queues</h4>
                    <Button size="sm" variant="ghost" className="text-primary">+ New Queue</Button>
                  </div>
                  
                  <div className="space-y-3">
                    {[
                      { name: "Main Queue", items: 12, speed: "Unlimited", color: "bg-green-500" },
                      { name: "Overnight Large Files", items: 3, speed: "50 MB/s", color: "bg-yellow-500" },
                      { name: "Media Imports", items: 0, speed: "Unlimited", color: "bg-blue-500" },
                    ].map((queue) => (
                      <div key={queue.name} className="group relative overflow-hidden rounded-xl border bg-card p-4 hover:border-primary/50 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full ${queue.color} shadow-[0_0_8px_rgba(var(--primary),0.5)]`} />
                            <div>
                              <h5 className="font-medium">{queue.name}</h5>
                              <p className="text-xs text-muted-foreground">{queue.items} files in queue</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="font-mono">{queue.speed}</Badge>
                            <Button size="icon" variant="ghost" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Settings2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>
            </div>
          </ScrollArea>
          
          <DialogFooter className="p-6 border-t bg-secondary/10">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="bg-primary hover:bg-primary/90" onClick={() => onOpenChange(false)}>Save Changes</Button>
          </DialogFooter>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

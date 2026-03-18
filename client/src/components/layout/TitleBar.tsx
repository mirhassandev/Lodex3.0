import React from 'react';
import { Minus, Square, X, Download } from 'lucide-react';

interface TitleBarProps {
  breadcrumb?: string;
}

export const TitleBar: React.FC<TitleBarProps> = ({ breadcrumb }) => {
  const electronAPI = (window as any).electronAPI;

  const handleMinimize = () => {
    if (electronAPI?.minimize) electronAPI.minimize();
  };

  const handleMaximize = () => {
    if (electronAPI?.maximize) electronAPI.maximize();
  };

  const handleClose = () => {
    if (electronAPI?.close) electronAPI.close();
  };

  // Only show title bar when dialog=true is NOT in URL, 
  // though the dialog also might need its own title bar if its frameless.
  // The user asked for "custom frameless look" generally.
  const isDialog = window.location.search.includes('dialog=true');

  return (
    <div className={`relative flex items-center justify-between h-10 bg-background border-b border-white/5 select-none ${isDialog ? 'rounded-t-xl' : ''}`}>
      <div className="flex-1 flex items-center px-4 title-drag h-full">
        {breadcrumb && (
          <div className="flex items-center gap-2 no-drag">
             <span className="text-[10px] text-white/20 font-bold uppercase tracking-wider">Library</span>
             <span className="text-[10px] text-white/10">/</span>
             <span className="text-[10px] text-primary font-bold uppercase tracking-wider">{breadcrumb}</span>
          </div>
        )}
        {/* Absolute centered title */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
           <span className="text-[11px] font-bold tracking-[0.3em] uppercase text-white/20 select-none">LodexPro</span>
        </div>
      </div>

      <div className="flex items-center h-full no-drag px-4 gap-2.5">
        <button
          onClick={handleMinimize}
          className="w-3.5 h-3.5 rounded-full bg-[#febc2e] hover:bg-[#febc2ecc] border border-[#d8a120] transition-colors"
          title="Minimize"
        />
        <button
          onClick={handleMaximize}
          className="w-3.5 h-3.5 rounded-full bg-[#28c840] hover:bg-[#28c840cc] border border-[#1a9a33] transition-colors"
          title="Zoom"
        />
        <button
          onClick={handleClose}
          className="w-3.5 h-3.5 rounded-full bg-[#ff5f57] hover:bg-[#ff5f57cc] border border-[#e0443e] transition-colors"
          title="Close"
        />
      </div>
    </div>
  );
};

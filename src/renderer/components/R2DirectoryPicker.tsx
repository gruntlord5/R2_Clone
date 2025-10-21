import * as React from "react";
import { useState, useEffect } from "react";
import { ChevronRight, File, Folder, HardDrive, Check, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";

interface R2DirectoryPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
  currentPath?: string;
  bucketId?: number;
  bucketName?: string;
}

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  loading?: boolean;
  loaded?: boolean;
}

export default function R2DirectoryPicker({ 
  open, 
  onOpenChange, 
  onSelect, 
  currentPath = '',
  bucketId,
  bucketName = 'Entire Bucket'
}: R2DirectoryPickerProps) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>(currentPath);
  const [loading, setLoading] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setSelectedPath(currentPath);
      loadRootContents();
    }
  }, [open, currentPath]);

  const loadRootContents = async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.backup.listDirectories('', bucketId);
      if (result.success && result.items) {
        const rootTree = result.items.map(item => ({
          name: item.name,
          path: item.name,
          type: item.type,
          children: item.type === 'folder' ? undefined : [],
          loaded: item.type === 'file'
        }));
        setTree(rootTree);
      }
    } catch (error) {
      console.error('Failed to load R2 contents:', error);
    } finally {
      setLoading(false);
    }
  };

  const buildTreeFromFiles = (files: string[], basePath: string): FileNode[] => {
    const tree: { [key: string]: FileNode } = {};
    
    files.forEach(file => {
      const relativePath = basePath ? file.substring(basePath.length) : file;
      const parts = relativePath.split('/').filter(p => p);
      
      if (parts.length === 0) return;
      
      // Get or create the first level folder/file
      const firstPart = parts[0];
      const firstPath = basePath ? `${basePath}/${firstPart}` : firstPart;
      
      if (!tree[firstPart]) {
        tree[firstPart] = {
          name: firstPart,
          path: firstPath,
          type: parts.length > 1 || file.endsWith('/') ? 'folder' : 'file',
          children: [],
          loaded: false
        };
      }
      
      // Mark as folder if we see it has children
      if (parts.length > 1) {
        tree[firstPart].type = 'folder';
      }
    });
    
    // Convert to array and sort (folders first, then alphabetically)
    return Object.values(tree).sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  };

  const loadFolderContents = async (node: FileNode) => {
    if (node.loaded || node.loading) return;
    
    // Update node to show loading
    updateNodeInTree(node.path, { loading: true });
    
    try {
      const result = await window.electronAPI.backup.listDirectories(node.path, bucketId);
      if (result.success && result.items) {
        const children = result.items.map(item => ({
          name: item.name,
          path: `${node.path}/${item.name}`,
          type: item.type,
          children: item.type === 'folder' ? undefined : [],
          loaded: item.type === 'file'
        }));
        updateNodeInTree(node.path, { 
          children, 
          loading: false, 
          loaded: true 
        });
      } else {
        // If no items, set empty children array
        updateNodeInTree(node.path, { 
          children: [], 
          loading: false, 
          loaded: true 
        });
      }
    } catch (error) {
      console.error('Failed to load folder contents:', error);
      updateNodeInTree(node.path, { loading: false });
    }
  };

  const updateNodeInTree = (path: string, updates: Partial<FileNode>) => {
    setTree(prevTree => {
      const updateNode = (nodes: FileNode[]): FileNode[] => {
        return nodes.map(node => {
          if (node.path === path) {
            return { ...node, ...updates };
          }
          if (node.children) {
            return { ...node, children: updateNode(node.children) };
          }
          return node;
        });
      };
      return updateNode(prevTree);
    });
  };

  const handleItemClick = async (path: string, node: FileNode) => {
    // Select the item
    setSelectedPath(path);
    
    // If it's a folder, handle expansion
    if (node.type === 'folder') {
      const newExpanded = new Set(expandedPaths);
      const isCurrentlyExpanded = newExpanded.has(path);
      
      if (isCurrentlyExpanded) {
        // If already expanded, collapse it
        newExpanded.delete(path);
      } else {
        // If not expanded, expand it
        newExpanded.add(path);
        // Load contents if not already loaded
        if (!node.loaded) {
          await loadFolderContents(node);
        }
      }
      setExpandedPaths(newExpanded);
    }
  };

  const handleSelect = () => {
    onSelect(selectedPath);
    onOpenChange(false);
  };

  const TreeItem = ({ item, level = 0 }: { item: FileNode; level?: number }) => {
    const isExpanded = expandedPaths.has(item.path);
    const isSelected = selectedPath === item.path;
    const isFolder = item.type === 'folder';
    
    if (!isFolder) {
      return null; // Don't show files, only folders
    }

    return (
      <div>
        <div
          className={cn(
            "flex items-center gap-2 px-2 py-1.5 hover:bg-muted rounded-sm cursor-pointer",
            isSelected && "bg-primary/10 text-primary border-l-2 border-primary"
          )}
          style={{ paddingLeft: `${level * 20 + 8}px` }}
          onClick={() => handleItemClick(item.path, item)}
        >
          {/* Show chevron until we know it has no subdirectories (only check for folders, not files) */}
          {(!item.loaded || (item.children && item.children.filter(child => child.type === 'folder').length > 0)) ? (
            <ChevronRight 
              className={cn(
                "h-3 w-3 transition-transform flex-shrink-0",
                isExpanded && "rotate-90"
              )}
            />
          ) : (
            <div className="w-3 h-3 flex-shrink-0" /> 
          )}
          <Folder className="h-4 w-4 flex-shrink-0" />
          <span className="text-sm flex-1">{item.name}</span>
          {item.loading && <Loader2 className="h-3 w-3 animate-spin" />}
          {isSelected && <Check className="h-4 w-4 text-primary" />}
        </div>
        {isExpanded && item.children && (
          <div>
            {item.children.map((child, index) => (
              <TreeItem key={index} item={child} level={level + 1} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Select R2 Source Folder</DialogTitle>
          <DialogDescription>
            Choose a folder from your R2 bucket to backup, or select "{bucketName}" to backup the entire bucket.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Folder Tree with Bucket as Root */}
          <ScrollArea className="h-[350px] pr-4">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <div className="space-y-1">
                {/* Bucket Root */}
                <div
                  className={cn(
                    "flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer hover:bg-muted",
                    selectedPath === '' && "bg-primary/10 text-primary border-l-2 border-primary"
                  )}
                  onClick={() => setSelectedPath('')}
                >
                  <HardDrive className="h-4 w-4 flex-shrink-0" />
                  <span className="font-medium flex-1">{bucketName}</span>
                  {selectedPath === '' && <Check className="h-4 w-4 text-primary" />}
                </div>
                
                {/* Folders under bucket */}
                {tree.length === 0 ? (
                  <div className="text-center py-4 text-sm text-muted-foreground ml-6">
                    No folders in this bucket
                  </div>
                ) : (
                  tree.map((item, index) => (
                    <TreeItem key={index} item={item} level={1} />
                  ))
                )}
              </div>
            )}
          </ScrollArea>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSelect}>
            Select {selectedPath ? 'Folder' : bucketName}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
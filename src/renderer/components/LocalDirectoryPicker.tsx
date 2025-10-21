"use client"

import React, { useState, useEffect } from "react"
import { FolderIcon, ChevronRight, ChevronLeft, Home, ArrowUp, FileText, Download, LayoutGrid, List } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog"
import { Button } from "~/components/ui/button"
import { apiClient } from "~/lib/api-client"

interface LocalDirectoryPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (path: string) => void
  currentPath?: string
}

interface DirectoryItem {
  name: string
  path: string
  children?: string[]
}

const indent = 20

export default function LocalDirectoryPicker({
  open,
  onOpenChange,
  onSelect,
  currentPath = "",
}: LocalDirectoryPickerProps) {
  const [selectedPath, setSelectedPath] = useState<string>(currentPath)
  const [currentDirectory, setCurrentDirectory] = useState<string>('/')
  const [directoryContents, setDirectoryContents] = useState<DirectoryItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [navigationHistory, setNavigationHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [navigationError, setNavigationError] = useState<string>('')

  // Special paths - detect on mount
  const [specialPaths, setSpecialPaths] = useState({
    home: '/',
    desktop: '',
    documents: '',
    downloads: '',
  })

  // View mode - grid or list
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  useEffect(() => {
    if (open) {
      const initDirectory = currentPath || '/'
      setSelectedPath(currentPath)
      setCurrentDirectory(initDirectory)
      setNavigationError('')
      setNavigationHistory([initDirectory])
      setHistoryIndex(0)
      detectSpecialPaths()
      loadDirectory(initDirectory)
    }
  }, [open, currentPath])

  const detectSpecialPaths = async () => {
    try {
      // Try to get special paths from API (Electron or web server)
      if (window.electronAPI?.settings?.getSpecialPaths) {
        const result = await window.electronAPI.settings.getSpecialPaths()
        if (result.success && result.paths) {
          setSpecialPaths(result.paths)
          return
        }
      }

      // Fallback to platform detection
      const platform = navigator.platform.toLowerCase()
      if (platform.includes('mac')) {
        setSpecialPaths({
          home: '/Users',
          desktop: '/Users/Desktop',
          documents: '/Users/Documents',
          downloads: '/Users/Downloads',
        })
      } else if (platform.includes('linux')) {
        setSpecialPaths({
          home: '/home',
          desktop: '/home/Desktop',
          documents: '/home/Documents',
          downloads: '/home/Downloads',
        })
      } else if (platform.includes('win')) {
        setSpecialPaths({
          home: 'C:\\Users',
          desktop: 'C:\\Users\\Desktop',
          documents: 'C:\\Users\\Documents',
          downloads: 'C:\\Users\\Downloads',
        })
      }
    } catch (error) {
      console.error('Failed to detect special paths:', error)
      setSpecialPaths({
        home: '/',
        desktop: '',
        documents: '',
        downloads: '',
      })
    }
  }

  const loadDirectory = async (dirPath: string) => {
    setIsLoading(true)
    setNavigationError('')

    try {
      console.log('[LocalDirectoryPicker] Loading directory:', dirPath)
      const result = await apiClient.backup.listDirectories(dirPath)

      if (result.success && result.items) {
        // Filter only folders and create directory items
        const folders = result.items
          .filter(item => item.type === 'folder')
          .map(item => {
            const separator = dirPath.endsWith('/') ? '' : '/'
            return {
              name: item.name,
              path: `${dirPath}${separator}${item.name}`,
              children: undefined
            }
          })

        console.log('[LocalDirectoryPicker] Loaded', folders.length, 'folders')
        setDirectoryContents(folders)
        setCurrentDirectory(dirPath)
      } else {
        setDirectoryContents([])
        setNavigationError(result.error || 'Failed to load directory')
      }
    } catch (error: any) {
      console.error('Failed to load directory:', error)
      setDirectoryContents([])
      setNavigationError(error.message || 'Failed to load directory')
    } finally {
      setIsLoading(false)
    }
  }

  const navigateToDirectory = (dirPath: string, addToHistory = true) => {
    if (addToHistory) {
      // Add to history
      const newHistory = navigationHistory.slice(0, historyIndex + 1)
      newHistory.push(dirPath)
      setNavigationHistory(newHistory)
      setHistoryIndex(newHistory.length - 1)
    }

    loadDirectory(dirPath)
  }

  const goBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1
      setHistoryIndex(newIndex)
      loadDirectory(navigationHistory[newIndex])
    }
  }

  const goForward = () => {
    if (historyIndex < navigationHistory.length - 1) {
      const newIndex = historyIndex + 1
      setHistoryIndex(newIndex)
      loadDirectory(navigationHistory[newIndex])
    }
  }

  const goUp = () => {
    if (currentDirectory === '/') return

    const separator = currentDirectory.includes('\\') ? '\\' : '/'
    const parts = currentDirectory.split(separator).filter(p => p)
    parts.pop() // Remove last part
    const parentPath = parts.length > 0 ? separator + parts.join(separator) : separator

    navigateToDirectory(parentPath)
  }

  const goHome = () => {
    navigateToDirectory(specialPaths.home)
  }

  const getBreadcrumbs = () => {
    if (currentDirectory === '/') {
      return [{ name: 'Root', path: '/' }]
    }

    const separator = currentDirectory.includes('\\') ? '\\' : '/'
    const parts = currentDirectory.split(separator).filter(p => p)
    const breadcrumbs = [{ name: 'Root', path: separator }]

    let currentPath = ''
    for (const part of parts) {
      currentPath += separator + part
      breadcrumbs.push({ name: part, path: currentPath })
    }

    return breadcrumbs
  }

  const getQuickAccessLocations = () => {
    return [
      { name: 'Home', path: specialPaths.home, icon: Home },
      { name: 'Desktop', path: specialPaths.desktop, icon: FolderIcon },
      { name: 'Documents', path: specialPaths.documents, icon: FileText },
      { name: 'Downloads', path: specialPaths.downloads, icon: Download },
    ].filter(location => location.path) // Filter out empty paths
  }

  const handleSelect = () => {
    if (selectedPath) {
      onSelect(selectedPath)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[85vw] sm:max-w-[85vw] h-[90vh] p-0 gap-0 flex flex-col">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
          <DialogTitle>Select Backup Destination</DialogTitle>
          <DialogDescription className="text-xs">
            Choose a folder on your system where backups will be stored. A folder named "R2Clone" will be created at this location.
          </DialogDescription>
        </DialogHeader>

        {/* Main Content Area - Two Column Layout */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Sidebar */}
          <div className="w-40 border-r bg-muted/30 p-2 overflow-y-auto flex-shrink-0">
            <div className="space-y-0.5">
              <p className="text-[10px] font-semibold text-muted-foreground px-2 mb-1">FAVORITES</p>
              {getQuickAccessLocations().map((location) => {
                const Icon = location.icon
                return (
                  <button
                    key={location.path}
                    onClick={() => navigateToDirectory(location.path)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-xs transition-colors"
                  >
                    <Icon className="size-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="truncate">{location.name}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Main Area */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b bg-background flex-shrink-0">
              {/* Navigation Controls */}
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={goBack}
                  disabled={historyIndex <= 0}
                  className="h-7 w-7 p-0"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={goUp}
                  disabled={currentDirectory === '/'}
                  className="h-7 w-7 p-0"
                >
                  <ArrowUp className="size-4" />
                </Button>
              </div>

              {/* Breadcrumb Navigation */}
              <div className="flex items-center gap-0.5 flex-1 min-w-0 px-2 py-1 bg-muted/50 rounded">
                <div className="flex items-center gap-0.5 min-w-0 overflow-hidden">
                  {getBreadcrumbs().map((crumb, index, array) => (
                    <React.Fragment key={crumb.path}>
                      <button
                        onClick={() => navigateToDirectory(crumb.path)}
                        className="text-xs font-medium hover:text-primary transition-colors px-1 truncate flex-shrink-0"
                        title={crumb.name}
                      >
                        {crumb.name}
                      </button>
                      {index < array.length - 1 && (
                        <ChevronRight className="size-3 text-muted-foreground flex-shrink-0" />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* View Toggle */}
              <div className="flex items-center gap-0.5 border rounded-md p-0.5 flex-shrink-0">
                <Button
                  variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('grid')}
                  className="h-6 w-6 p-0"
                >
                  <LayoutGrid className="size-3.5" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                  className="h-6 w-6 p-0"
                >
                  <List className="size-3.5" />
                </Button>
              </div>
            </div>

            {/* Error Display */}
            {navigationError && (
              <div className="text-xs text-red-600 dark:text-red-400 px-3 py-2 bg-red-50 dark:bg-red-900/20 border-b flex-shrink-0">
                {navigationError}
              </div>
            )}

            {/* Directory Contents */}
            <div className="flex-1 overflow-auto p-3 bg-background min-h-0">
              {isLoading ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  Loading directories...
                </div>
              ) : directoryContents.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No subdirectories
                </div>
              ) : viewMode === 'grid' ? (
                <div className="grid grid-cols-3 gap-2">
                  {directoryContents.map((folder) => (
                    <button
                      key={folder.path}
                      onClick={() => setSelectedPath(folder.path)}
                      onDoubleClick={() => navigateToDirectory(folder.path)}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-lg hover:bg-muted/50 transition-all ${
                        selectedPath === folder.path
                          ? 'bg-primary/10 ring-2 ring-primary/50'
                          : 'hover:shadow-sm'
                      }`}
                    >
                      <FolderIcon className={`size-10 flex-shrink-0 ${
                        selectedPath === folder.path ? 'text-primary' : 'text-blue-500'
                      }`} />
                      <span className="text-xs text-center break-words line-clamp-2 w-full">
                        {folder.name}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="divide-y rounded-md border">
                  {directoryContents.map((folder) => (
                    <button
                      key={folder.path}
                      onClick={() => setSelectedPath(folder.path)}
                      onDoubleClick={() => navigateToDirectory(folder.path)}
                      className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors ${
                        selectedPath === folder.path ? 'bg-primary/10' : ''
                      }`}
                    >
                      <FolderIcon className={`size-4 flex-shrink-0 ${
                        selectedPath === folder.path ? 'text-primary' : 'text-blue-500'
                      }`} />
                      <span className="text-xs truncate text-left">{folder.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-3 border-t flex items-center gap-2 flex-shrink-0">
          {selectedPath && (
            <div className="flex-1 min-w-0 mr-2">
              <p className="text-[10px] text-muted-foreground">Selected:</p>
              <p className="text-xs font-mono truncate">{selectedPath}</p>
            </div>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-shrink-0">
            Cancel
          </Button>
          <Button onClick={handleSelect} disabled={!selectedPath} className="flex-shrink-0">
            Select Folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

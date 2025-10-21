import { Outlet, Link, useLocation, useNavigate } from 'react-router';
import { Home, Database, Settings, Sun, Moon, Info } from 'lucide-react';
import { cn } from '~/lib/utils';
import { useState, useEffect, useRef } from 'react';
import { Button } from '~/components/ui/button';
import { AboutDialog, type AboutDialogRef } from '~/components/about-dialog';
import { Toaster } from '~/components/ui/sonner';

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const aboutDialogRef = useRef<AboutDialogRef>(null);

  // Check if running in Electron
  const isElectron = typeof window !== 'undefined' &&
    typeof (window as any).electronAPI?.versions?.electron !== 'undefined';

  useEffect(() => {
    // Load theme from settings
    loadTheme();

    // Listen for system theme changes when in system mode
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') {
        applyTheme('system');
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  useEffect(() => {
    // Listen for IPC message to show about dialog (Electron only)
    if (!isElectron) return;

    const handleShowAbout = () => {
      aboutDialogRef.current?.open();
    };

    window.electronAPI.app.onShowAbout(handleShowAbout);

    // Cleanup listener on unmount
    return () => {
      // Note: We don't have a way to remove this specific listener with the current API
      // This is fine since this component stays mounted throughout the app lifecycle
    };
  }, [isElectron]);

  useEffect(() => {
    // Listen for IPC message to navigate to a specific route (Electron only)
    if (!isElectron) return;

    const handleNavigateTo = (path: string) => {
      navigate(path);
    };

    window.electronAPI.app.onNavigateTo(handleNavigateTo);

    // Cleanup listener on unmount
    return () => {
      // Note: We don't have a way to remove this specific listener with the current API
      // This is fine since this component stays mounted throughout the app lifecycle
    };
  }, [navigate, isElectron]);

  const loadTheme = async () => {
    try {
      const settings = await window.electronAPI.settings.get();
      let savedTheme = settings?.theme || 'system';
      
      // If it's system, determine the actual theme based on OS preference
      if (savedTheme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        savedTheme = prefersDark ? 'dark' : 'light';
      }
      
      setTheme(savedTheme);
      applyTheme(savedTheme);
    } catch (error) {
      console.error('Failed to load theme:', error);
      // Default to system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const defaultTheme = prefersDark ? 'dark' : 'light';
      setTheme(defaultTheme);
      applyTheme(defaultTheme);
    }
  };

  const applyTheme = (theme: 'light' | 'dark' | 'system') => {
    const root = document.documentElement;
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', prefersDark);
    } else {
      root.classList.toggle('dark', theme === 'dark');
    }
  };

  const toggleTheme = async () => {
    // Simple toggle between light and dark
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    applyTheme(nextTheme);
    
    // Save theme to settings
    try {
      const settings = await window.electronAPI.settings.get();
      await window.electronAPI.settings.update({ ...settings, theme: nextTheme });
    } catch (error) {
      console.error('Failed to save theme:', error);
    }
  };

  const getThemeIcon = () => {
    // Show the opposite icon (what it will switch to)
    return theme === 'light' 
      ? <Moon className="h-4 w-4 text-foreground" />
      : <Sun className="h-4 w-4 text-foreground" />;
  };

  const navItems = [
    { path: '/', label: 'Home', icon: Home },
    { path: '/backups', label: 'Backups', icon: Database },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-[#1a1a1a]">
      <header className="border-b">
        <div className="flex h-16 items-center px-6 justify-between">
          <div className="flex items-center">
            <h1 className="text-2xl font-bold" style={{ color: '#f6821f' }}>
              R2Clone
            </h1>
            <nav className="ml-4 flex items-center space-x-1">
              {navItems.map(({ path, label, icon: Icon }) => {
                const isActive = path === '/' 
                  ? location.pathname === '/'
                  : location.pathname.startsWith(path);
                
                return (
                  <Link
                    key={path}
                    to={path}
                    className={cn(
                      "flex items-center gap-1 px-2 py-2 text-sm font-medium rounded-lg transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </Link>
                );
              })}
              {/* About Dialog */}
              <AboutDialog 
                ref={aboutDialogRef}
                trigger={
                  <button
                    className={cn(
                      "flex items-center gap-1 px-2 py-2 text-sm font-medium rounded-lg transition-colors",
                      "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    <Info className="h-4 w-4" />
                    
                  </button>
                }
              />
            </nav>
          </div>
          
          {/* Theme Toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="h-9 w-9"
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {getThemeIcon()}
            <span className="sr-only">Toggle theme</span>
          </Button>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto py-6 px-6">
          <Outlet />
        </div>
      </main>
      <Toaster position="bottom-center" richColors />
    </div>
  );
}
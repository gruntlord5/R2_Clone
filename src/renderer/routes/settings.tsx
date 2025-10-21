import { useState } from 'react';

export default function Settings() {
  const [theme, setTheme] = useState('light');
  const [autoStart, setAutoStart] = useState(false);
  const [notifications, setNotifications] = useState(true);

  const handleSave = () => {
    // Here you would typically save to electron store or preferences
    console.log('Settings saved:', { theme, autoStart, notifications });
    alert('Settings saved successfully!');
  };

  return (
    <div className="page">
      <h2>Settings</h2>
      <div className="settings-form">
        <div className="setting-group">
          <label htmlFor="theme">Theme:</label>
          <select 
            id="theme" 
            value={theme} 
            onChange={(e) => setTheme(e.target.value)}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </div>

        <div className="setting-group">
          <label>
            <input
              type="checkbox"
              checked={autoStart}
              onChange={(e) => setAutoStart(e.target.checked)}
            />
            Launch at startup
          </label>
        </div>

        <div className="setting-group">
          <label>
            <input
              type="checkbox"
              checked={notifications}
              onChange={(e) => setNotifications(e.target.checked)}
            />
            Enable notifications
          </label>
        </div>

        <button onClick={handleSave} className="save-button">
          Save Settings
        </button>
      </div>
    </div>
  );
}
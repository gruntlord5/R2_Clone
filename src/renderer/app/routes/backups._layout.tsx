import { Outlet } from 'react-router';
import { ErrorBoundary } from '~/components/ErrorBoundary';

export default function BackupsLayout() {
  return (
    <ErrorBoundary 
      isolate
      onReset={() => {
        // Force a re-render of the backup component
        window.location.reload();
      }}
    >
      <Outlet />
    </ErrorBoundary>
  );
}
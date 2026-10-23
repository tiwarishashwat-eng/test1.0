import React, { useState, useEffect } from 'react';
import { Header, AppView, ServerStatus } from './components/common/Header.js';
import { Footer } from './components/common/Footer.js';
import { StudentPortal } from './components/student/StudentPortal.js';
import { StaffDashboard } from './components/staff/StaffDashboard.js';
import { AdminConsole } from './components/admin/AdminConsole.js';
import { ResponderDashboard } from './components/responder/ResponderDashboard.js';
import { DemoWalkthroughModal } from './components/demo/DemoWalkthroughModal.js';
import { AuthModal } from './components/auth/AuthModal.js';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { apiClient } from './services/apiClient.js';

function AppContent() {
  const { user } = useAuth();
  const [currentView, setCurrentView] = useState<AppView>('student');
  const [ticketToTrack, setTicketToTrack] = useState<string>('');
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'student-login' | 'staff-login' | 'register'>('student-login');

  const [serverHealth, setServerHealth] = useState<ServerStatus | undefined>(undefined);

  // Refresh the server's observed AI status on mount and whenever the view changes,
  // so a failed or successful AI request is reflected without a full reload.
  useEffect(() => {
    apiClient.checkHealth()
      .then((data) => {
        setServerHealth({ gemini: data.gemini, demoMode: Boolean(data.demoMode), emergencyContact: data.emergencyContact ?? null });
      })
      .catch((err) => {
        console.warn('[App] Health check failed:', err);
        setServerHealth(undefined);
      });
  }, [currentView]);

  // When user signs in or changes, adjust default view safely
  useEffect(() => {
    if (user?.role === 'staff' && currentView === 'student') {
      setCurrentView('staff');
    } else if (user?.role === 'admin' && currentView === 'student') {
      setCurrentView('admin');
    } else if (user?.role === 'responder' && currentView !== 'responder') {
      setCurrentView('responder');
    } else if (!user && (currentView === 'responder' || currentView === 'admin' || currentView === 'staff')) {
      setCurrentView('student');
    }
  }, [user]);

  const handleNavigate = (view: AppView, ticketId?: string) => {
    if (ticketId) {
      setTicketToTrack(ticketId);
    }
    setCurrentView(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenAuth = (mode: 'student-login' | 'staff-login' | 'register' = 'student-login') => {
    setAuthModalMode(mode);
    setIsAuthModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900 antialiased selection:bg-blue-600 selection:text-white">
      {/* Top Header */}
      <Header
        currentView={currentView}
        onNavigate={handleNavigate}
        onOpenAuthModal={handleOpenAuth}
        onOpenDemoGuide={() => setIsDemoModalOpen(true)}
        serverStatus={serverHealth}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {currentView === 'student' && (
          <StudentPortal
            initialMode="my-complaints"
            onNavigateToStaff={() => handleNavigate('staff')}
            onOpenAuthModal={handleOpenAuth}
            onOpenDemoGuide={() => setIsDemoModalOpen(true)}
          />
        )}

        {currentView === 'track' && (
          <StudentPortal
            initialMode="track"
            initialTicketId={ticketToTrack}
            onNavigateToStaff={() => handleNavigate('staff')}
            onOpenAuthModal={handleOpenAuth}
            onOpenDemoGuide={() => setIsDemoModalOpen(true)}
          />
        )}

        {currentView === 'staff' && (
          <StaffDashboard
            onOpenDemoGuide={() => setIsDemoModalOpen(true)}
            onOpenAuthModal={() => handleOpenAuth('staff-login')}
          />
        )}

        {currentView === 'admin' && (
          <AdminConsole />
        )}

        {currentView === 'responder' && <ResponderDashboard />}
      </main>

      {/* Footer */}
      <Footer emergencyContact={serverHealth?.emergencyContact} />

      {/* Authentication Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        defaultMode={authModalMode}
      />

      {/* Read-only "how it works" guide */}
      <DemoWalkthroughModal
        isOpen={isDemoModalOpen}
        onClose={() => setIsDemoModalOpen(false)}
        onNavigate={handleNavigate}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

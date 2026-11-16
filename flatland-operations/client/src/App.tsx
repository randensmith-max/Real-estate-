import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { Loading } from "./components/ui";
import { ChangePasswordPage, LoginPage, SetupPage } from "./pages/Auth";
import { CustomerDetailPage, CustomersPage } from "./pages/Customers";
import { DashboardPage } from "./pages/Dashboard";
import { DocumentDetailPage, DocumentsPage } from "./pages/Documents";
import { InspectionDetailPage, InspectionsPage, PerformInspectionPage } from "./pages/Inspections";
import { InventoryPage, ItemDetailPage } from "./pages/Inventory";
import { JobDetailPage, JobsPage } from "./pages/Jobs";
import { MaintenanceDetailPage, MaintenancePage } from "./pages/Maintenance";
import { ReportsPage } from "./pages/Reports";
import { SettingsPage } from "./pages/Settings";
import { PersonPage, TeamPage } from "./pages/Team";
import { TimeClockPage } from "./pages/TimeClock";
import { TimeOffPage } from "./pages/TimeOff";
import { TimesheetDetailPage, TimesheetsPage } from "./pages/Timesheets";

export function App() {
  const { me, loading, needsSetup } = useAuth();
  if (loading) return <Loading />;
  if (!me) return needsSetup ? <SetupPage /> : <LoginPage />;
  if (me.user.must_change_password) return <ChangePasswordPage forced />;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/clock" element={<TimeClockPage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/jobs/:id" element={<JobDetailPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/customers/:id" element={<CustomerDetailPage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/team/:id" element={<PersonPage />} />
        <Route path="/timesheets" element={<TimesheetsPage />} />
        <Route path="/timesheets/:userId/:week" element={<TimesheetDetailPage />} />
        <Route path="/time-off" element={<TimeOffPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/inventory/:id" element={<ItemDetailPage />} />
        <Route path="/maintenance" element={<MaintenancePage />} />
        <Route path="/maintenance/:id" element={<MaintenanceDetailPage />} />
        <Route path="/inspections" element={<InspectionsPage />} />
        <Route path="/inspections/new" element={<PerformInspectionPage />} />
        <Route path="/inspections/:id" element={<InspectionDetailPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/documents/:id" element={<DocumentDetailPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/account/password" element={<ChangePasswordPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

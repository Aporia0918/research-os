import { lazy, Suspense, useState, type ReactNode } from "react";
import { createHashRouter, Navigate, RouterProvider } from "react-router";
import { MonitorX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthState } from "@/api/queries";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState, ErrorState } from "@/components/layout/state";
import { Skeleton } from "@/components/ui/misc";
import { LoginPage, PairPage, SetupPage } from "@/pages/Auth";

const LiteraturePage = lazy(() => import("@/pages/Literature").then(m => ({ default: m.LiteraturePage })));
const LiteratureReviewPage = lazy(() => import("@/pages/LiteratureReview").then(m => ({ default: m.LiteratureReviewPage })));
const LibraryPage = lazy(() => import("@/pages/Library").then((m) => ({ default: m.LibraryPage })));
const ResearchPage = lazy(() => import("@/pages/Research").then((m) => ({ default: m.ResearchPage })));
const ProjectDetailPage = lazy(() => import("@/pages/ProjectDetail").then((m) => ({ default: m.ProjectDetailPage })));
const ProjectsPage = lazy(() => import("@/pages/Projects").then((m) => ({ default: m.ProjectsPage })));
const SettingsPage = lazy(() => import("@/pages/Settings").then((m) => ({ default: m.SettingsPage })));
const DocEditorPage = lazy(() => import("@/pages/DocEditor").then((m) => ({ default: m.DocEditorPage })));
const TasksPage = lazy(() => import("@/pages/Tasks").then((m) => ({ default: m.TasksPage })));
const ExperimentsPage = lazy(() => import("@/pages/Experiments").then((m) => ({ default: m.ExperimentsPage })));
const ExperimentPlanPage = lazy(() => import("@/pages/ExperimentPlan").then((m) => ({ default: m.ExperimentPlanPage })));
const ExperimentRunPage = lazy(() => import("@/pages/ExperimentRun").then((m) => ({ default: m.ExperimentRunPage })));
const StudiesPage = lazy(() => import("@/pages/Studies").then((m) => ({ default: m.StudiesPage })));
const StudyDetailPage = lazy(() => import("@/pages/StudyDetail").then((m) => ({ default: m.StudyDetailPage })));
const MindLedgerPage = lazy(() => import("@/pages/MindLedger").then((m) => ({ default: m.MindLedgerPage })));
function NotFound() {
  const { t } = useTranslation();
  return <EmptyState title={t("app.notFoundTitle")} body={t("app.notFoundBody")} />;
}

const page = (el: ReactNode) => <Suspense fallback={<Skeleton className="h-24" />}>{el}</Suspense>;

const router = createHashRouter([
  {
    path: "/", element: <AppShell />, children: [
      { index: true, element: <Navigate to="/projects" replace /> },
      { path: "projects", element: page(<ProjectsPage />) },
      { path: "projects/:id", element: page(<ProjectDetailPage />) },
      { path: "projects/:id/docs/:docId", element: page(<DocEditorPage />) },
      { path: "literature", element: page(<LiteraturePage />) },
      { path: "literature/reviews/:reviewId", element: page(<LiteratureReviewPage />) },
      { path: "library", element: page(<LibraryPage />) },
      { path: "research", element: page(<ResearchPage />) },
      { path: "experiments", element: page(<ExperimentsPage />) },
      { path: "experiments/tasks/:taskId", element: page(<ExperimentRunPage />) },
      { path: "experiments/:planId/:revision", element: page(<ExperimentPlanPage />) },
      { path: "studies", element: page(<StudiesPage />) },
      { path: "studies/:studyId", element: page(<StudyDetailPage />) },
      { path: "ledger", element: page(<MindLedgerPage />) },
      { path: "tasks", element: page(<TasksPage />) },
      { path: "settings", element: page(<SettingsPage />) },
      { path: "pair", element: <Navigate to="/projects" replace /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

export function App() {
  const { t } = useTranslation();
  const auth = useAuthState();
  const [pairing, setPairing] = useState(() => window.location.hash.startsWith("#/pair"));
  if (auth.isPending) return <div className="p-8"><Skeleton className="h-10 w-48" /></div>;
  if (auth.isError) return <div className="mx-auto max-w-lg p-8"><ErrorState error={auth.error} onRetry={() => void auth.refetch()} /></div>;
  const a = auth.data;
  if (!a.initialized) {
    return a.setup_allowed ? <SetupPage /> : (
      <div className="mx-auto max-w-lg p-8">
        <EmptyState icon={<MonitorX />} title={t("app.hostSetupTitle")} body={t("app.hostSetupBody")} />
      </div>
    );
  }
  if (!a.authenticated) return pairing ? <PairPage onBack={() => setPairing(false)} /> : <LoginPage onPair={() => setPairing(true)} />;
  return <RouterProvider router={router} />;
}

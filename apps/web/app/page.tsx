'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpLeft,
  Blocks,
  BookOpen,
  Box,
  Braces,
  Check,
  CheckCheck,
  ChevronLeft,
  CircleHelp,
  Clock3,
  Code2,
  Cpu,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  LayoutDashboard,
  LayoutTemplate,
  LoaderCircle,
  Menu,
  Pause,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  WandSparkles,
  Workflow,
  X,
  Eye,
  AlertCircle,
} from 'lucide-react';

type Status =
  | 'queued'
  | 'analyzing'
  | 'awaiting_approval'
  | 'planning'
  | 'generating'
  | 'validating'
  | 'awaiting_review'
  | 'completed'
  | 'cancelled'
  | 'failed';
type RunEvent = { id: number; message: string; created_at: string };
type Run = {
  id: string;
  project_id: string;
  status: Status;
  version: number;
  requirements: string;
  approved_version: number | null;
  artifacts: Record<string, string>;
  events: RunEvent[];
  created_at: string;
  updated_at: string;
  model_calls: number;
  provider: string;
};
type Project = {
  id: string;
  name: string;
  description: string;
  template: string;
  created_at: string;
  latest_run: Pick<Run, 'id' | 'status' | 'version' | 'updated_at'> | null;
};
type Detail = Project & { runs: Run[] };
type View = 'overview' | 'projects' | 'templates' | 'workflow' | 'settings' | 'detail';
type Filter = 'all' | 'active' | 'review' | 'completed';
type Tab = 'overview' | 'requirements' | 'files' | 'events';

const statusLabels: Record<Status, string> = {
  queued: 'في الانتظار',
  analyzing: 'إعداد المتطلبات',
  awaiting_approval: 'بانتظار موافقتك',
  planning: 'تخطيط المشروع',
  generating: 'تجهيز القالب',
  validating: 'فحص الحزمة',
  awaiting_review: 'جاهز للمراجعة',
  completed: 'مكتمل',
  cancelled: 'متوقف',
  failed: 'تعذّر الإكمال',
};
const automatic: Status[] = ['queued', 'analyzing', 'planning', 'generating', 'validating'];
const terminal: Status[] = ['completed', 'cancelled', 'failed'];
const review: Status[] = ['awaiting_approval', 'awaiting_review'];
const progress: Record<Status, number> = {
  queued: 5,
  analyzing: 15,
  awaiting_approval: 25,
  planning: 40,
  generating: 60,
  validating: 80,
  awaiting_review: 95,
  completed: 100,
  cancelled: 0,
  failed: 0,
};
const sample = {
  name: 'مساحة المهام',
  description:
    'أريد لوحة مهام عربية بسيطة تساعدني على تنظيم يومي. أستطيع إضافة مهمة، تحديدها كمكتملة وحذفها، مع عداد للإنجاز وحفظ المهام محليًا في المتصفح.',
};
const nav = [
  { id: 'overview', label: 'نظرة عامة', icon: LayoutDashboard },
  { id: 'projects', label: 'المشاريع', icon: FolderOpen },
  { id: 'templates', label: 'مكتبة القوالب', icon: LayoutTemplate },
  { id: 'workflow', label: 'سير العمل', icon: Workflow },
] as const;

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`/api/v1${path}`, {
      ...init,
      signal: init?.signal ?? controller.signal,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(
        typeof data.detail === 'string'
          ? data.detail
          : res.status === 422
            ? 'تحقق من طول الحقول والبيانات المدخلة.'
            : 'لم يكتمل الطلب. حاول مجددًا.',
        res.status,
      );
    }
    return res.status === 204 ? (undefined as T) : await res.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error(
      controller.signal.aborted
        ? 'تأخر رد الخادم. قد يكون الطلب قد وصل؛ حدّث الحالة قبل إعادة المحاولة.'
        : 'تعذر الاتصال بالخادم. تحقق من تشغيل خدمة API ثم حاول مجددًا.',
    );
  } finally {
    clearTimeout(timer);
  }
}
const date = (value: string) =>
  new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short' }).format(new Date(value));
const time = (value: string) =>
  new Intl.DateTimeFormat('ar', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const number = (value: number) =>
  new Intl.NumberFormat('en-US', { minimumIntegerDigits: 2 }).format(value);

function StatusBadge({ status }: { status?: Status }) {
  return (
    <span className={`status-badge ${status || 'draft'}`}>
      <span />
      {status ? statusLabels[status] : 'مسودة جديدة'}
    </span>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label={title}
    >
      <div className="modal-body">
        <div className="modal-header">
          <div>
            <span className="eyebrow">SOFTWARE FACTORY</span>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="إغلاق">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export default function Home() {
  const [view, setView] = useState<View>('overview');
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [requirements, setRequirements] = useState('');
  const [paused, setPaused] = useState(false);
  const [file, setFile] = useState('README.md');
  const searchRef = useRef<HTMLInputElement>(null);
  const loadSequence = useRef(0);
  // Preserve an attempt's key across network-error retries, not just double clicks.
  const runRequestKeys = useRef(new Map<string, string>());

  const notify = useCallback((text: string, error = false) => setToast({ text, error }), []);
  const refreshProjects = useCallback(async () => {
    const items = await api<Project[]>('/projects');
    setProjects(items);
    setConnected(true);
    setLoadError('');
  }, []);
  const initialLoad = useCallback(async () => {
    setLoading(true);
    try {
      await refreshProjects();
    } catch (e) {
      setLoadError((e as Error).message);
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, [refreshProjects]);
  useEffect(() => {
    void initialLoad();
  }, [initialLoad]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);
  useEffect(() => {
    setRequirements(run?.requirements || '');
  }, [run?.id, run?.requirements]);

  const acceptRun = useCallback((updated: Run) => {
    setRun((current) =>
      current?.id === updated.id && current.version <= updated.version ? updated : current,
    );
    setDetail((current) =>
      current
        ? {
            ...current,
            runs: current.runs.map((item) => (item.id === updated.id ? updated : item)),
          }
        : current,
    );
    if (updated.status === 'awaiting_approval') setTab('requirements');
  }, []);

  useEffect(() => {
    if (!run || view !== 'detail' || paused || busy || !automatic.includes(run.status)) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const updated = await api<Run>(`/runs/${run.id}/advance`, {
          method: 'POST',
          body: JSON.stringify({ version: run.version }),
        });
        if (active) acceptRun(updated);
        await refreshProjects();
      } catch (e) {
        if (!active) return;
        if (e instanceof ApiError && e.status === 409) {
          try {
            const updated = await api<Run>(`/runs/${run.id}`);
            if (active) acceptRun(updated);
          } catch (err) {
            setPaused(true);
            notify((err as Error).message, true);
          }
        } else {
          setPaused(true);
          notify((e as Error).message, true);
        }
      }
    }, 1100);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [run, view, paused, busy, acceptRun, refreshProjects, notify]);

  function navigate(next: View) {
    setView(next);
    setSidebarOpen(false);
    if (next !== 'projects') setSearch('');
  }
  function openCreate(useSample = false) {
    setProjectName(useSample ? sample.name : '');
    setDescription(useSample ? sample.description : '');
    setFormError('');
    setShowCreate(true);
  }
  async function openProject(project: Project) {
    const sequence = ++loadSequence.current;
    setView('detail');
    setSidebarOpen(false);
    setDetailLoading(true);
    setDetailError('');
    setDetail(null);
    setRun(null);
    setPaused(false);
    setTab('overview');
    try {
      const result = await api<Detail>(`/projects/${project.id}`);
      if (sequence !== loadSequence.current) return;
      setDetail(result);
      setRun(result.runs[0] || null);
      if (result.runs[0]?.status === 'awaiting_approval') setTab('requirements');
    } catch (e) {
      if (sequence === loadSequence.current) setDetailError((e as Error).message);
    } finally {
      if (sequence === loadSequence.current) setDetailLoading(false);
    }
  }
  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      const project = await api<Project>('/projects', {
        method: 'POST',
        body: JSON.stringify({ name: projectName, description, template: 'taskboard' }),
      });
      setProjects((current) => [project, ...current]);
      setShowCreate(false);
      notify('مساحة مشروعك جاهزة. ابدأ التشغيل عندما تكون مستعدًا.');
      await openProject(project);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function startRun() {
    if (!detail) return;
    setBusy(true);
    const requestKey = runRequestKeys.current.get(detail.id) ?? crypto.randomUUID();
    runRequestKeys.current.set(detail.id, requestKey);
    try {
      const result = await api<Run>(`/projects/${detail.id}/runs`, {
        method: 'POST',
        headers: { 'Idempotency-Key': requestKey },
        body: '{}',
      });
      runRequestKeys.current.delete(detail.id);
      setRun(result);
      setDetail((current) => (current ? { ...current, runs: [result, ...current.runs] } : current));
      setPaused(false);
      setTab('overview');
      await refreshProjects();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function runAction(action: string, body?: object, method = 'POST') {
    if (!run) return;
    setBusy(true);
    try {
      const result = await api<Run>(`/runs/${run.id}/${action}`, {
        method,
        body: JSON.stringify({ version: run.version, ...body }),
      });
      acceptRun(result);
      setPaused(false);
      await refreshProjects();
      if (action === 'requirements') notify('حُفظت المتطلبات. يمكنك الآن اعتماد هذه النسخة.');
      if (action === 'approve-delivery') notify('اكتمل المشروع التجريبي. حزمتك جاهزة للتنزيل.');
    } catch (e) {
      notify((e as Error).message, true);
      if (e instanceof ApiError && e.status === 409) {
        try {
          acceptRun(await api<Run>(`/runs/${run.id}`));
        } catch {
          /* original error remains visible */
        }
      }
    } finally {
      setBusy(false);
    }
  }
  async function deleteProject() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api(`/projects/${deleteTarget.id}`, { method: 'DELETE' });
      setProjects((current) => current.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
      notify('تم حذف المشروع وتشغيلاته وملفاته.');
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  const activeCount = projects.filter(
    (p) => p.latest_run && !terminal.includes(p.latest_run.status),
  ).length;
  const reviewCount = projects.filter(
    (p) => p.latest_run && review.includes(p.latest_run.status),
  ).length;
  const completedCount = projects.filter((p) => p.latest_run?.status === 'completed').length;
  const visibleProjects = projects.filter((p) => {
    const state = p.latest_run?.status;
    const matches = `${p.name} ${p.description}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase().trim());
    return (
      matches &&
      (filter === 'all' ||
        (filter === 'active' && state && !terminal.includes(state)) ||
        (filter === 'review' && state && review.includes(state)) ||
        (filter === 'completed' && state === 'completed'))
    );
  });
  const viewTitle = {
    overview: 'نظرة عامة',
    projects: 'المشاريع',
    templates: 'مكتبة القوالب',
    workflow: 'سير العمل',
    settings: 'إعدادات المساحة',
    detail: 'مساحة المشروع',
  }[view];
  const dirtyRequirements = requirements !== (run?.requirements || '');

  function ProjectCard({ project, index }: { project: Project; index: number }) {
    const status = project.latest_run?.status;
    return (
      <article
        className="project-card"
        style={{ '--card-delay': `${index * 55}ms` } as React.CSSProperties}
      >
        <div className="project-card-top">
          <div className={`project-mark mark-${index % 3}`}>
            <LayoutDashboard size={23} strokeWidth={1.6} />
          </div>
          <button
            className="icon-button subtle"
            title="حذف المشروع"
            aria-label={`حذف ${project.name}`}
            onClick={() => setDeleteTarget(project)}
          >
            <Trash2 size={16} />
          </button>
        </div>
        <button className="project-title" onClick={() => void openProject(project)}>
          {project.name}
          <ArrowUpLeft size={19} />
        </button>
        <p className="project-description">{project.description}</p>
        <div className="project-tags">
          <span>
            <Code2 size={12} /> HTML / CSS / JS
          </span>
          <span>قالب تجريبي</span>
        </div>
        <div className="project-progress">
          <div style={{ width: `${status ? progress[status] : 0}%` }} />
        </div>
        <div className="project-card-footer">
          <StatusBadge status={status} />
          <span className="muted small">
            <Clock3 size={12} />
            {date(project.created_at)}
          </span>
        </div>
      </article>
    );
  }

  function ProjectGrid({ dashboard = false }: { dashboard?: boolean }) {
    const list = dashboard ? projects.slice(0, 3) : visibleProjects;
    return loading ? (
      <div className="project-grid">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton project-skeleton" />
        ))}
      </div>
    ) : list.length ? (
      <div className="project-grid">
        {list.map((p, i) => (
          <ProjectCard key={p.id} project={p} index={i} />
        ))}
      </div>
    ) : (
      <div className="empty-projects">
        <div className="empty-icon">
          <FolderOpen size={28} strokeWidth={1.5} />
        </div>
        <div>
          <h3>
            {search || filter !== 'all' ? 'لا توجد مشاريع مطابقة' : 'أول مشروع لك يبدأ بفكرة'}
          </h3>
          <p>
            {search || filter !== 'all'
              ? 'جرّب بحثًا آخر أو غيّر التصفية لعرض مشاريعك.'
              : 'اكتب ما تريد بناءه، ودع مساحة العمل ترتّب الخطوات معك.'}
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() => {
            if (search || filter !== 'all') {
              setSearch('');
              setFilter('all');
            } else openCreate();
          }}
        >
          {search || filter !== 'all' ? 'عرض كل المشاريع' : 'إنشاء أول مشروع'}
          <Plus size={16} />
        </button>
      </div>
    );
  }

  function Templates({ full = false }: { full?: boolean }) {
    return (
      <div className={`template-grid ${full ? 'full' : ''}`}>
        <button className="template-card available" onClick={() => openCreate(true)}>
          <div className="template-preview tasks-preview">
            <div className="mini-sidebar">
              <span />
              <span />
              <span />
            </div>
            <div className="mini-task-main">
              <div className="mini-heading" />
              <div className="mini-columns">
                {[0, 1, 2].map((n) => (
                  <div key={n}>
                    <i />
                    <span />
                    <span className={n === 1 ? 'orange-mini' : ''} />
                  </div>
                ))}
              </div>
            </div>
            <span className="template-label">جاهز للتجربة</span>
          </div>
          <div className="template-info">
            <div>
              <h3>لوحة إدارة المهام</h3>
              <p>مساحة بسيطة لتنظيم يومك وإنجاز أكثر.</p>
            </div>
            <span className="template-arrow">
              <ArrowUpLeft size={18} />
            </span>
          </div>
          <div className="template-meta">
            <span>تطبيق ويب</span>
            <span>HTML · CSS · JavaScript</span>
          </div>
        </button>
        <div className="template-card coming">
          <div className="template-preview store-preview">
            <div className="store-nav" />
            <div className="store-banner">
              <div />
              <span />
            </div>
            <div className="store-products">
              <i />
              <i />
              <i />
            </div>
            <span className="template-label">قريبًا</span>
          </div>
          <div className="template-info">
            <div>
              <h3>واجهة متجر إلكتروني</h3>
              <p>واجهة لعرض المنتجات وتجربة التسوّق.</p>
            </div>
            <Box size={20} />
          </div>
          <div className="template-meta">
            <span>واجهة متجر</span>
            <span>ضمن خارطة الطريق</span>
          </div>
        </div>
        <div className="template-card coming">
          <div className="template-preview analytics-preview">
            <div className="analytics-top">
              <i />
              <i />
              <i />
            </div>
            <div className="mini-chart">
              {[30, 50, 40, 75, 55, 95, 75, 100, 88].map((n, i) => (
                <span key={i} style={{ height: `${n}%` }} />
              ))}
            </div>
            <span className="template-label">قريبًا</span>
          </div>
          <div className="template-info">
            <div>
              <h3>لوحة تحليلات الأعمال</h3>
              <p>قراءة أوضح للأرقام والمؤشرات المهمة.</p>
            </div>
            <Activity size={20} />
          </div>
          <div className="template-meta">
            <span>لوحة تحكم</span>
            <span>ضمن خارطة الطريق</span>
          </div>
        </div>
      </div>
    );
  }

  function Pipeline({ compact = false }: { compact?: boolean }) {
    const steps = [
      {
        title: 'تحليل الفكرة',
        desc: 'إعداد مسودة متطلبات من وصفك',
        icon: Sparkles,
        states: ['queued', 'analyzing', 'awaiting_approval'],
      },
      {
        title: 'خطة التنفيذ',
        desc: 'تقسيم العمل إلى خطوات واضحة',
        icon: GitBranch,
        states: ['planning'],
      },
      {
        title: 'تجهيز القالب',
        desc: 'نسخ القالب الثابت وإرفاق الوثائق',
        icon: Code2,
        states: ['generating'],
      },
      {
        title: 'فحص الحزمة',
        desc: 'التحقق من الملفات، دون تنفيذ الكود',
        icon: ShieldCheck,
        states: ['validating'],
      },
      {
        title: 'المراجعة والتسليم',
        desc: 'موافقتك الأخيرة قبل تنزيل المشروع',
        icon: CheckCheck,
        states: ['awaiting_review', 'completed'],
      },
    ];
    const currentIndex = run ? steps.findIndex((s) => s.states.includes(run.status)) : -1;
    return (
      <div className={compact ? 'pipeline compact' : 'pipeline'}>
        {steps.map((step, i) => {
          const done = !!run && (run.status === 'completed' || currentIndex > i);
          const current = currentIndex === i && run?.status !== 'completed';
          return (
            <div
              key={step.title}
              className={`pipeline-step ${done ? 'done' : ''} ${current ? 'current' : ''}`}
            >
              <div className="step-icon">
                {done ? <Check size={18} /> : <step.icon size={19} />}
              </div>
              <div>
                <h4>{step.title}</h4>
                <p>{step.desc}</p>
              </div>
              <span className="step-state">
                {done
                  ? 'تم'
                  : current
                    ? review.includes(run!.status)
                      ? 'بانتظارك'
                      : paused
                        ? 'مؤقتًا'
                        : 'جارٍ العمل'
                    : `0${i + 1}`}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        انتقل إلى المحتوى
      </a>
      {sidebarOpen && (
        <button
          className="sidebar-overlay"
          aria-label="إغلاق القائمة"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <button
          className="brand"
          onClick={() => navigate('overview')}
          aria-label="Software Factory — الرئيسية"
        >
          <span className="brand-symbol">
            <Blocks size={26} strokeWidth={1.5} />
          </span>
          <span dir="ltr">
            <strong>SOFTWARE</strong>
            <span>
              F A C T O R Y<span className="brand-dot">.</span>
            </span>
          </span>
        </button>
        <div className="workspace-switch">
          <div className="workspace-icon">
            <Box size={17} />
          </div>
          <div>
            <strong>مساحة العمل التجريبية</strong>
            <span>النسخة التأسيسية</span>
          </div>
          <span className="workspace-version">v0.1</span>
        </div>
        <div className="nav-caption">مساحة البناء</div>
        <nav aria-label="التنقل الرئيسي">
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-link ${view === item.id || (item.id === 'projects' && view === 'detail') ? 'active' : ''}`}
              aria-current={view === item.id ? 'page' : undefined}
              onClick={() => {
                setFilter('all');
                navigate(item.id);
              }}
            >
              <item.icon size={19} strokeWidth={1.7} />
              <span>{item.label}</span>
              {item.id === 'projects' && <small>{projects.length}</small>}
              {item.id === 'overview' && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="nav-divider" />
        <div className="nav-caption">تفضيلات المساحة</div>
        <button
          className={`nav-link ${view === 'settings' ? 'active' : ''}`}
          onClick={() => navigate('settings')}
        >
          <Settings2 size={19} strokeWidth={1.7} />
          <span>الإعدادات</span>
        </button>
        <button className="nav-link" onClick={() => setShowHelp(true)}>
          <BookOpen size={19} strokeWidth={1.7} />
          <span>دليل الاستخدام</span>
          <ArrowUpLeft size={14} />
        </button>
        <div className="sidebar-bottom">
          <div className="demo-sidebar">
            <span className="demo-sidebar-icon">
              <Sparkles size={18} />
            </span>
            <h4>فكرتك الكبيرة، خطوتك الأولى.</h4>
            <p>جرّب رحلة البناء بقالب جاهز، دون مفاتيح أو تكلفة نماذج.</p>
            <button onClick={() => openCreate(true)}>
              جرّب مشروعًا تجريبيًا
              <ArrowLeft size={15} />
            </button>
          </div>
          <div className="system-status">
            <span className={connected ? 'online-dot' : 'offline-dot'} />
            {connected
              ? 'خدمة المشاريع متصلة'
              : loading
                ? 'جارٍ الاتصال بالخادم'
                : 'الخادم غير متصل'}
            <span>LOCAL</span>
          </div>
          <div className="user-profile">
            <div className="avatar">م</div>
            <div>
              <strong>مساحتك المحلية</strong>
              <span>مستخدم واحد · وضع تجريبي</span>
            </div>
            <ShieldCheck size={18} />
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setSidebarOpen(true)}
              aria-label="فتح القائمة"
            >
              <Menu size={21} />
            </button>
            <span>مساحة العمل</span>
            <ChevronLeft size={13} />
            <strong>{viewTitle}</strong>
          </div>
          <div className="topbar-actions">
            <div className="search-box">
              <Search size={16} />
              <input
                ref={searchRef}
                aria-label="البحث في المشاريع"
                placeholder="ابحث عن مشروع..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setFilter('all');
                  setView('projects');
                }}
              />
              <kbd dir="ltr">⌘ K</kbd>
            </div>
            <span className="topbar-divider" />
            <button
              className="icon-button help-button"
              onClick={() => setShowHelp(true)}
              aria-label="المساعدة"
            >
              <CircleHelp size={19} />
            </button>
            <div className="avatar small-avatar">م</div>
          </div>
        </header>

        <main id="main-content" className="main-content">
          {loadError && (
            <div className="error-banner" role="alert">
              <AlertCircle size={20} />
              <span>{loadError}</span>
              <button onClick={() => void initialLoad()}>إعادة المحاولة</button>
            </div>
          )}
          <div className="environment-note">
            <ShieldCheck size={14} />
            <span>وضع تجريبي دون نموذج AI متصل · مساحة بلا مصادقة، استخدم بيانات تجريبية فقط.</span>
            <button onClick={() => navigate('settings')}>
              تفاصيل البيئة
              <ChevronLeft size={12} />
            </button>
          </div>
          {view === 'overview' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="greeting">مساحة للأفكار. مصنع للبرمجيات.</div>
                  <h1>
                    لنصنع شيئًا رائعًا<span className="orange-dot">.</span>
                  </h1>
                  <p>كل ما تحتاجه للانتقال من «لديّ فكرة» إلى أول مشروع قابل للتشغيل.</p>
                </div>
                <button className="button primary" onClick={() => openCreate()}>
                  <Plus size={18} />
                  مشروع جديد
                </button>
              </div>
              <section className="hero-card">
                <div className="hero-content">
                  <div className="hero-eyebrow">
                    <span />
                    <span>فكّر. ابنِ. طوّر.</span>
                    <span className="hero-badge">نسخة تجريبية</span>
                  </div>
                  <h2>
                    أنت تأتي بالفكرة.
                    <br />
                    ونحن نرتّب <em>رحلة بنائها.</em>
                  </h2>
                  <p>
                    حوّل وصفك إلى متطلبات واضحة، راجع كل خطوة،
                    <br className="desktop-break" /> وانطلق بمشروعك الأول من مساحة واحدة.
                  </p>
                  <div className="hero-actions">
                    <button className="button dark" onClick={() => openCreate()}>
                      ابدأ بفكرتك
                      <ArrowLeft size={17} />
                    </button>
                    <button className="text-button" onClick={() => navigate('workflow')}>
                      <span className="play-circle">
                        <Play size={11} fill="currentColor" />
                      </span>
                      كيف يعمل المصنع؟
                    </button>
                  </div>
                  <span className="hero-note">
                    <ShieldCheck size={13} />
                    موافقتك أولًا. لا نشر تلقائي، ولا تكاليف نماذج.
                  </span>
                </div>
                <div className="factory-visual" aria-hidden="true">
                  <div className="visual-grid" />
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="visual-dots dots-one" />
                  <div className="visual-dots dots-two" />
                  <div className="core-shadow" />
                  <div className="factory-core">
                    <div className="core-top">
                      <Blocks size={54} strokeWidth={1.15} />
                    </div>
                    <div className="core-label" dir="ltr">
                      FACTORY ENGINE
                      <span>
                        <i />
                        DEMO MODE
                      </span>
                    </div>
                  </div>
                  <div className="floating-node node-idea">
                    <span className="node-icon peach">
                      <Sparkles size={18} />
                    </span>
                    <div>
                      <small>01 / IDEA</small>
                      <strong>فكرتك تبدأ هنا</strong>
                    </div>
                    <span className="node-dot" />
                  </div>
                  <div className="floating-node node-code">
                    <span className="node-icon green">
                      <Code2 size={19} />
                    </span>
                    <div>
                      <small>02 / BUILD</small>
                      <strong>خطوات واضحة</strong>
                    </div>
                    <Check size={13} />
                  </div>
                  <div className="floating-node node-ship">
                    <span className="node-icon purple">
                      <Box size={18} />
                    </span>
                    <div>
                      <small>03 / DELIVER</small>
                      <strong>جاهز للانطلاق</strong>
                    </div>
                    <ArrowUpLeft size={14} />
                  </div>
                  <div className="visual-caption">
                    <span /> A LITTLE IDEA. A REAL BEGINNING.
                  </div>
                </div>
              </section>
              <section className="stats-grid" aria-label="إحصائيات المشاريع">
                {[
                  {
                    title: 'إجمالي المشاريع',
                    value: projects.length,
                    icon: Folder,
                    caption: 'أفكارك في مساحة واحدة',
                    color: 'neutral',
                    target: 'all',
                  },
                  {
                    title: 'قيد العمل',
                    value: activeCount,
                    icon: Workflow,
                    caption: 'خطوة أقرب إلى الإنجاز',
                    color: 'orange',
                    target: 'active',
                  },
                  {
                    title: 'بانتظار مراجعتك',
                    value: reviewCount,
                    icon: Eye,
                    caption: 'قرارات تحتاج لمستك',
                    color: 'purple',
                    target: 'review',
                  },
                  {
                    title: 'مشاريع مكتملة',
                    value: completedCount,
                    icon: CheckCheck,
                    caption: 'حزم معتمدة للتسليم',
                    color: 'green',
                    target: 'completed',
                  },
                ].map((stat) => (
                  <button
                    className="stat-card"
                    key={stat.title}
                    onClick={() => {
                      setFilter(stat.target as Filter);
                      navigate('projects');
                    }}
                  >
                    <div className="stat-top">
                      <span>{stat.title}</span>
                      <span className={`stat-icon ${stat.color}`}>
                        <stat.icon size={18} strokeWidth={1.6} />
                      </span>
                    </div>
                    <strong className="stat-value">{loading ? '—' : number(stat.value)}</strong>
                    <span className="stat-caption">
                      {stat.caption}
                      <ArrowUpLeft size={13} />
                    </span>
                  </button>
                ))}
              </section>
              <section className="content-section">
                <div className="section-heading">
                  <div>
                    <h2>
                      مشاريعك الأخيرة <span className="count-badge">{projects.length}</span>
                    </h2>
                    <p>كل فكرة لها مساحة، وكل مشروع له خطوة تالية.</p>
                  </div>
                  <button
                    className="text-button muted"
                    onClick={() => {
                      setFilter('all');
                      navigate('projects');
                    }}
                  >
                    عرض كل المشاريع
                    <ArrowLeft size={15} />
                  </button>
                </div>
                <ProjectGrid dashboard />
              </section>
              <section className="content-section template-section">
                <div className="section-heading">
                  <div>
                    <h2>
                      بداية أسرع، بإلهام جاهز <Sparkles size={17} />
                    </h2>
                    <p>لا تبدأ من صفحة بيضاء. اختر نقطة انطلاق لفكرتك.</p>
                  </div>
                  <button className="text-button muted" onClick={() => navigate('templates')}>
                    استكشف القوالب
                    <ArrowLeft size={15} />
                  </button>
                </div>
                <Templates />
              </section>
              <div className="bottom-note">
                <div>
                  <span className="bottom-note-icon">
                    <GitBranch size={20} />
                  </span>
                  <div>
                    <strong>بناء منظّم، من أول سطر.</strong>
                    <p>متطلبات واضحة، موافقات بشرية، وملفات قابلة للمراجعة في كل مرحلة.</p>
                  </div>
                </div>
                <span className="pill">مصمم ليُبنى عليه</span>
              </div>
            </>
          )}

          {view === 'projects' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="greeting">مساحة البناء</div>
                  <h1>
                    كل مشروع، بداية جديدة<span className="orange-dot">.</span>
                  </h1>
                  <p>تابع أفكارك وتشغيلاتها، وراجع الخطوة التالية لكل مشروع.</p>
                </div>
                <button className="button primary" onClick={() => openCreate()}>
                  <Plus size={18} />
                  مشروع جديد
                </button>
              </div>
              <div className="projects-toolbar">
                <div className="filter-tabs" aria-label="تصفية المشاريع">
                  {(
                    [
                      ['all', 'كل المشاريع', projects.length],
                      ['active', 'قيد العمل', activeCount],
                      ['review', 'للمراجعة', reviewCount],
                      ['completed', 'مكتملة', completedCount],
                    ] as const
                  ).map(([id, label, count]) => (
                    <button
                      key={id}
                      aria-pressed={filter === id}
                      className={filter === id ? 'selected' : ''}
                      onClick={() => setFilter(id)}
                    >
                      {label}
                      <span>{count}</span>
                    </button>
                  ))}
                </div>
                <span className="small muted">الأحدث أولًا</span>
              </div>
              <ProjectGrid />
              <div className="local-notice">
                <ShieldCheck size={16} />
                <span>
                  المشاريع محفوظة في قاعدة بيانات محلية على الخادم. هذه مساحة تجريبية مشتركة وليست
                  حسابًا خاصًا؛ لا تضف معلومات حساسة.
                </span>
              </div>
            </>
          )}

          {view === 'templates' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="greeting">نقطة انطلاق مدروسة</div>
                  <h1>
                    أقل إعدادًا، أكثر إنجازًا<span className="orange-dot">.</span>
                  </h1>
                  <p>قوالب صغيرة، واضحة، وقابلة للتجربة. لوحة المهام متاحة الآن.</p>
                </div>
                <span className="pill">
                  <LayoutTemplate size={14} />
                  قالب واحد متاح
                </span>
              </div>
              <div className="info-banner">
                <Sparkles size={19} />
                <div>
                  <strong>قالب جاهز، وليس توليدًا بالذكاء الاصطناعي بعد.</strong>
                  <p>
                    المتطلبات قابلة للتعديل والتوثيق، لكن كود القالب ثابت في هذه النسخة. المزيد من
                    القوالب ضمن خارطة الطريق.
                  </p>
                </div>
              </div>
              <Templates full />
              <div className="template-explainer">
                <h2>ماذا يتضمن القالب الأول؟</h2>
                <div>
                  {[
                    'واجهة عربية متجاوبة',
                    'إضافة المهام وحذفها وإنجازها',
                    'حفظ محلي دون خادم',
                    'ملفات HTML وCSS وJavaScript',
                    'وثيقة المتطلبات وخطة التنفيذ',
                    'تقرير فحوص بنية الحزمة',
                  ].map((text) => (
                    <span key={text}>
                      <Check size={16} />
                      {text}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}

          {view === 'workflow' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="greeting">وضوح في كل مرحلة</div>
                  <h1>
                    من فكرة، إلى حزمة بين يديك<span className="orange-dot">.</span>
                  </h1>
                  <p>خمس مراحل، ونقطتا اعتماد. أنت صاحب القرار طوال الرحلة.</p>
                </div>
                <button className="button primary" onClick={() => openCreate(true)}>
                  جرّب الرحلة
                  <ArrowLeft size={16} />
                </button>
              </div>
              <div className="workflow-layout">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>
                      <Workflow size={20} />
                      مسار البناء التجريبي
                    </h2>
                    <span className="pill">محاكاة حتمية</span>
                  </div>
                  {[
                    [
                      '01',
                      'فكرتك تصبح متطلبات',
                      'نسجل وصف المشروع ونجهز مسودة من القالب. راجعها، عدّلها ثم اعتمد نسختك.',
                    ],
                    [
                      '02',
                      'خطة واضحة قبل الكود',
                      'خطة ثابتة تشرح الملفات التي سنجهزها وكيف سنراجعها. لا تُستدعى نماذج خارجية.',
                    ],
                    [
                      '03',
                      'تجهيز الملفات',
                      'ننسخ قالب لوحة المهام الموثوق ونرفق المتطلبات والخطة. لا يتم توليد أو تنفيذ كود غير موثوق.',
                    ],
                    [
                      '04',
                      'فحوص الحزمة',
                      'نتأكد من وجود الملفات ومطابقة القالب والمتطلبات. هذه ليست اختبارات تشغيل للتطبيق.',
                    ],
                    [
                      '05',
                      'مراجعتك، ثم التسليم',
                      'تصفح الملفات والمعاينة المعزولة، واعتمد التسليم لتنزيل الحزمة بصيغة ZIP.',
                    ],
                  ].map(([n, title, desc]) => (
                    <div className="workflow-row" key={n}>
                      <span>{n}</span>
                      <div>
                        <h3>{title}</h3>
                        <p>{desc}</p>
                      </div>
                      {(n === '01' || n === '05') && <span className="approval-tag">موافقتك</span>}
                    </div>
                  ))}
                </section>
                <aside className="workflow-notes">
                  <div className="dark-panel">
                    <ShieldCheck size={29} />
                    <h3>
                      التحكم لك.
                      <br />
                      من البداية إلى النهاية.
                    </h3>
                    <p>لا استدعاءات مدفوعة. لا نشر تلقائي. لا أوامر نظام يولدها نموذج.</p>
                  </div>
                  <div className="panel note-panel">
                    <Clock3 size={21} />
                    <h3>توقف، ثم تابع.</h3>
                    <p>
                      تُحفظ كل خطوة على الخادم. تعمل المحاكاة عند فتح المشروع فقط؛ يمكنك العودة
                      والمتابعة لاحقًا.
                    </p>
                  </div>
                </aside>
              </div>
            </>
          )}

          {view === 'settings' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="greeting">معلومات البيئة</div>
                  <h1>
                    أساس بسيط. حدود واضحة<span className="orange-dot">.</span>
                  </h1>
                  <p>الوضع الحالي للمصنع، وما هو متاح في هذه النسخة.</p>
                </div>
                <span className="pill">v0.1.0</span>
              </div>
              <section className="panel settings-panel">
                <div className="panel-heading">
                  <h2>
                    <Settings2 size={20} />
                    مساحة العمل المحلية
                  </h2>
                  <button className="text-button" onClick={() => void initialLoad()}>
                    تحديث الحالة
                  </button>
                </div>
                {[
                  ['الاتصال بالخادم', connected ? 'متصل · FastAPI' : 'غير متصل'],
                  ['تخزين المشاريع', 'SQLite · حفظ دائم على الخادم'],
                  ['مزود الذكاء الاصطناعي', 'محاكاة حتمية · لا يوجد مزود متصل'],
                  ['تكلفة النماذج', '0 · لا استدعاءات خارجية'],
                  ['قالب المشاريع', 'لوحة مهام · HTML / CSS / JavaScript'],
                  ['حدود المساحة', '100 مشروع · 20 تشغيلًا لكل مشروع'],
                  ['المصادقة', 'غير مفعلة · ليست خدمة متعددة المستخدمين'],
                  ['تنفيذ الكود', 'غير مفعل · فحص بنية الحزمة فقط'],
                ].map(([label, value]) => (
                  <div className="settings-row" key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </section>
              <div className="warning-banner">
                <ShieldCheck size={21} />
                <div>
                  <strong>هذه بيئة تطوير وليست جاهزة للإنتاج.</strong>
                  <p>
                    أي شخص لديه رابط هذه المعاينة يستطيع الوصول إلى مساحة العمل. لا تضف أسرارًا أو
                    مفاتيح API أو بيانات عملاء. المصادقة والعزل المتقدم وربط النماذج خطوات لاحقة.
                  </p>
                </div>
              </div>
            </>
          )}

          {view === 'detail' && (
            <>
              <button className="text-button back-link" onClick={() => navigate('projects')}>
                <ArrowLeft className="flip" size={16} />
                العودة إلى المشاريع
              </button>
              {detailLoading ? (
                <div className="loading-detail">
                  <LoaderCircle size={28} className="spin" />
                  <p>نجهّز مساحة مشروعك...</p>
                </div>
              ) : detailError ? (
                <div className="error-banner">
                  <AlertCircle size={20} />
                  {detailError}
                  <button onClick={() => navigate('projects')}>العودة للمشاريع</button>
                </div>
              ) : (
                detail && (
                  <>
                    <div className="page-heading detail-heading">
                      <div>
                        <div className="detail-title">
                          <span className="project-mark mark-0">
                            <LayoutDashboard size={24} />
                          </span>
                          <h1>{detail.name}</h1>
                        </div>
                        <p className="detail-description">{detail.description}</p>
                      </div>
                      <div className="detail-header-actions">
                        <StatusBadge status={run?.status} />
                        {(!run || terminal.includes(run.status)) &&
                          !detail.runs.some((item) => !terminal.includes(item.status)) && (
                            <button
                              className="button primary"
                              disabled={busy}
                              onClick={() => void startRun()}
                            >
                              {busy ? (
                                <LoaderCircle size={16} className="spin" />
                              ) : (
                                <Play size={16} />
                              )}
                              {run ? 'تشغيل جديد' : 'ابدأ التشغيل التجريبي'}
                            </button>
                          )}
                      </div>
                    </div>
                    <div className="run-info">
                      <span>
                        <Cpu size={14} />
                        محاكاة تجريبية · دون نموذج AI
                      </span>
                      <span>
                        <Code2 size={14} />
                        قالب لوحة مهام ثابت
                      </span>
                      {run && (
                        <span dir="ltr" className="run-id">
                          RUN / {run.id.slice(0, 8)}
                        </span>
                      )}
                      {detail.runs.length > 1 && (
                        <label className="run-select">
                          التشغيل
                          <select
                            aria-label="اختيار التشغيل"
                            value={run?.id}
                            onChange={(e) => {
                              setRun(detail.runs.find((r) => r.id === e.target.value) || null);
                              setTab('overview');
                              setPaused(false);
                            }}
                          >
                            {detail.runs.map((r, i) => (
                              <option key={r.id} value={r.id}>
                                #{detail.runs.length - i} · {statusLabels[r.status]}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                    {run?.status === 'awaiting_approval' && (
                      <div className="approval-banner">
                        <span className="approval-icon">
                          <FileText size={22} />
                        </span>
                        <div>
                          <strong>قبل أن نكمل، نحتاج لموافقتك.</strong>
                          <p>
                            راجع المتطلبات واحفظ أي تعديلات. اعتمادها يوثّق النطاق ولا يخصص كود
                            القالب الثابت.
                          </p>
                        </div>
                        <button
                          className="button primary"
                          disabled={busy || dirtyRequirements}
                          title={dirtyRequirements ? 'احفظ التعديلات أولًا' : ''}
                          onClick={() => void runAction('approve-requirements')}
                        >
                          <Check size={16} />
                          اعتماد ومتابعة
                        </button>
                      </div>
                    )}
                    {run?.status === 'awaiting_review' && (
                      <div className="approval-banner green-banner">
                        <span className="approval-icon">
                          <CheckCheck size={22} />
                        </span>
                        <div>
                          <strong>الحزمة جاهزة. اللمسة الأخيرة لك.</strong>
                          <p>
                            تصفح الملفات وتقرير فحوص البنية، ثم اعتمد التسليم. لم يُنفذ اختبار تشغيل
                            تلقائي.
                          </p>
                        </div>
                        <button
                          className="button primary"
                          disabled={busy}
                          onClick={() => void runAction('approve-delivery')}
                        >
                          <Check size={16} />
                          اعتماد التسليم
                        </button>
                      </div>
                    )}
                    {run?.status === 'completed' && (
                      <div className="approval-banner green-banner">
                        <span className="approval-icon">
                          <Box size={22} />
                        </span>
                        <div>
                          <strong>من فكرة إلى أول حزمة. أحسنت!</strong>
                          <p>
                            ملفات القالب والوثائق والتقرير جاهزة. نزّل الحزمة وافتح index.html في
                            متصفحك.
                          </p>
                        </div>
                        <a
                          className="button dark"
                          href={`/api/v1/runs/${run.id}/download`}
                          download
                        >
                          <ArrowDownToLine size={17} />
                          تنزيل المشروع ZIP
                        </a>
                      </div>
                    )}
                    {run?.status === 'cancelled' && (
                      <div className="info-banner">
                        <Pause size={20} />
                        <p>
                          هذا التشغيل متوقف. يمكنك بدء تشغيل جديد، وسيبقى سجل المحاولة السابقة
                          محفوظًا.
                        </p>
                      </div>
                    )}
                    <div className="detail-tabs" role="tablist" aria-label="تفاصيل المشروع">
                      {(
                        [
                          ['overview', 'نظرة عامة', Workflow],
                          ['requirements', 'المتطلبات', FileText],
                          ['files', 'الملفات', FileCode2],
                          ['events', 'سجل النشاط', Activity],
                        ] as const
                      ).map(([id, label, Icon]) => (
                        <button
                          key={id}
                          role="tab"
                          aria-selected={tab === id}
                          aria-controls={`panel-${id}`}
                          id={`tab-${id}`}
                          tabIndex={tab === id ? 0 : -1}
                          onKeyDown={(event) => {
                            const tabs: Tab[] = ['overview', 'requirements', 'files', 'events'];
                            const index = tabs.indexOf(id);
                            const next =
                              event.key === 'ArrowLeft'
                                ? (index + 1) % tabs.length
                                : event.key === 'ArrowRight'
                                  ? (index + tabs.length - 1) % tabs.length
                                  : event.key === 'Home'
                                    ? 0
                                    : event.key === 'End'
                                      ? tabs.length - 1
                                      : null;
                            if (next !== null) {
                              event.preventDefault();
                              setTab(tabs[next]);
                              document.getElementById(`tab-${tabs[next]}`)?.focus();
                            }
                          }}
                          onClick={() => setTab(id)}
                          className={tab === id ? 'selected' : ''}
                        >
                          <Icon size={17} />
                          {label}
                          {id === 'files' && !!run && (
                            <span>{Object.keys(run.artifacts).length}</span>
                          )}
                        </button>
                      ))}
                    </div>
                    <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
                      {tab === 'overview' && (
                        <div className="workspace-layout">
                          <section className="panel">
                            <div className="panel-heading">
                              <h2>
                                <Workflow size={18} />
                                خط إنتاج المشروع
                              </h2>
                              {run && automatic.includes(run.status) && (
                                <button
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() => setPaused(!paused)}
                                >
                                  {paused ? <Play size={14} /> : <Pause size={14} />}
                                  {paused ? 'متابعة المحاكاة' : 'إيقاف مؤقت'}
                                </button>
                              )}
                            </div>
                            <Pipeline />
                            <div className="pipeline-footer">
                              <span>
                                <ShieldCheck size={14} />
                                كل انتقال يُحفظ على الخادم.
                              </span>
                              {run && !terminal.includes(run.status) && (
                                <button
                                  className="text-button danger-text"
                                  disabled={busy}
                                  onClick={() => void runAction('cancel')}
                                >
                                  <Square size={12} />
                                  إنهاء التشغيل
                                </button>
                              )}
                            </div>
                            {run && automatic.includes(run.status) && (
                              <p className="simulation-note">
                                {paused
                                  ? 'المحاكاة متوقفة مؤقتًا.'
                                  : 'المحاكاة تتقدم ما دامت مساحة المشروع مفتوحة. يمكنك مغادرتها والعودة لاحقًا.'}
                              </p>
                            )}
                          </section>
                          <div className="workspace-side">
                            <section className="panel">
                              <div className="panel-heading">
                                <h2>
                                  <Activity size={17} />
                                  آخر النشاطات
                                </h2>
                                <span className="live-label">
                                  <span />
                                  محفوظة
                                </span>
                              </div>
                              <EventList events={run?.events.slice(-4).reverse() || []} />
                            </section>
                            <div className="workspace-tip">
                              <span>
                                <WandSparkles size={21} />
                              </span>
                              <h3>خطوات صغيرة. أساس قوي.</h3>
                              <p>
                                هذه الرحلة تثبت المتطلبات والموافقات والتسليم. توليد الكود بالنماذج
                                وتنفيذه المعزول يأتيان في المرحلة التالية.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                      {tab === 'requirements' && (
                        <section className="panel">
                          <div className="panel-heading">
                            <h2>
                              <FileText size={18} />
                              وثيقة المتطلبات
                            </h2>
                            {run?.approved_version && (
                              <span className="pill green-pill">
                                <Check size={13} />
                                نسخة معتمدة
                              </span>
                            )}
                          </div>
                          {run?.requirements ? (
                            <>
                              <div className="editor-note">
                                وثيقة تخطيط قابلة للمراجعة. تعديلاتك لا تغير كود القالب في الوضع
                                التجريبي.
                              </div>
                              <textarea
                                aria-label="وثيقة المتطلبات"
                                className="requirements-editor"
                                value={requirements}
                                readOnly={run.status !== 'awaiting_approval'}
                                maxLength={12000}
                                minLength={20}
                                onChange={(e) => setRequirements(e.target.value)}
                              />
                              {run.status === 'awaiting_approval' && (
                                <div className="editor-footer">
                                  <span className="small muted">
                                    {dirtyRequirements
                                      ? 'لديك تعديلات غير محفوظة'
                                      : 'كل التعديلات محفوظة'}{' '}
                                    · {requirements.length.toLocaleString()} / 12,000
                                  </span>
                                  <button
                                    className="button secondary"
                                    disabled={
                                      busy || !dirtyRequirements || requirements.trim().length < 20
                                    }
                                    onClick={() =>
                                      void runAction('requirements', { requirements }, 'PUT')
                                    }
                                  >
                                    <Check size={15} />
                                    حفظ التعديلات
                                  </button>
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="panel-empty">
                              <FileText size={30} />
                              <h3>متطلبات واضحة قبل أي خطوة</h3>
                              <p>ابدأ التشغيل لإعداد مسودة من وصفك، ثم راجعها هنا.</p>
                            </div>
                          )}
                        </section>
                      )}
                      {tab === 'files' && (
                        <section className="panel">
                          <div className="panel-heading">
                            <h2>
                              <FolderOpen size={18} />
                              ملفات المشروع
                            </h2>
                            {run?.artifacts['index.html'] && (
                              <button
                                className="button secondary small-button"
                                onClick={() => setShowPreview(true)}
                              >
                                <Eye size={15} />
                                معاينة القالب
                              </button>
                            )}
                          </div>
                          {run && Object.keys(run.artifacts).length ? (
                            <>
                              <div className="editor-note">
                                قالب ثابت ووثائق مرتبطة بهذه المحاولة. التقرير يفحص بنية الحزمة فقط،
                                ولا يثبت جاهزية التطبيق للإنتاج.
                              </div>
                              <div className="file-browser">
                                <div className="file-tree" dir="ltr">
                                  {Object.keys(run.artifacts).map((name) => (
                                    <button
                                      key={name}
                                      className={file === name ? 'selected' : ''}
                                      onClick={() => setFile(name)}
                                    >
                                      <FileCode2 size={15} />
                                      {name}
                                    </button>
                                  ))}
                                </div>
                                <div className="file-content">
                                  <div className="file-content-heading" dir="ltr">
                                    <span>
                                      {file in run.artifacts ? file : Object.keys(run.artifacts)[0]}
                                    </span>
                                    <span>read-only</span>
                                  </div>
                                  <pre dir={file.endsWith('.md') ? 'auto' : 'ltr'}>
                                    {run.artifacts[file] ?? Object.values(run.artifacts)[0]}
                                  </pre>
                                </div>
                              </div>
                            </>
                          ) : (
                            <div className="panel-empty">
                              <Braces size={32} />
                              <h3>هنا ستجد أول ملفات مشروعك</h3>
                              <p>بعد اعتماد المتطلبات، نجهز القالب والوثائق ونضيف تقرير الفحص.</p>
                            </div>
                          )}
                        </section>
                      )}
                      {tab === 'events' && (
                        <section className="panel full-events">
                          <div className="panel-heading">
                            <h2>
                              <Terminal size={18} />
                              سجل التشغيل
                            </h2>
                            <span className="small muted">{run?.events.length || 0} أحداث</span>
                          </div>
                          <EventList events={run?.events || []} />
                        </section>
                      )}
                    </div>
                  </>
                )
              )}
            </>
          )}
          <footer className="page-footer">
            <span dir="ltr">
              SOFTWARE FACTORY <i> / </i> BUILD WITH INTENTION.
            </span>
            <span>نسخة تأسيسية · رحلة البناء تبدأ هنا</span>
          </footer>
        </main>
      </div>

      {showCreate && (
        <Modal
          title="ماذا تريد أن تبني اليوم؟"
          onClose={() => {
            if (!busy) setShowCreate(false);
          }}
          wide
        >
          <form onSubmit={(e) => void createProject(e)}>
            <p className="modal-description">
              كل مشروع رائع يبدأ بوصف بسيط. أخبرنا عن فكرتك، ثم راجع خطوات بنائها.
            </p>
            <div className="create-layout">
              <div className="create-fields">
                <label htmlFor="project-name">
                  اسم المشروع <span>*</span>
                </label>
                <input
                  id="project-name"
                  autoFocus
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  required
                  minLength={2}
                  maxLength={80}
                  placeholder="مثلًا: مساحة المهام"
                  disabled={busy}
                />
                <label htmlFor="project-description">
                  صف فكرتك <span>*</span>
                </label>
                <textarea
                  id="project-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  minLength={20}
                  maxLength={4000}
                  placeholder="ما الذي تريد بناءه؟ لمن؟ وما الوظائف الأساسية التي تحتاجها؟"
                  disabled={busy}
                />
                <div className="field-hint">
                  <span>20 حرفًا على الأقل. لا تُدخل معلومات حساسة.</span>
                  <span>{description.length}/4000</span>
                </div>
                <button
                  type="button"
                  className="text-button orange-text example-button"
                  onClick={() => {
                    setProjectName(sample.name);
                    setDescription(sample.description);
                  }}
                >
                  <Sparkles size={14} />
                  استخدم فكرة تجريبية
                </button>
              </div>
              <aside className="create-template">
                <span className="eyebrow">نقطة الانطلاق</span>
                <div className="create-template-icon">
                  <LayoutDashboard size={30} strokeWidth={1.4} />
                </div>
                <h3>لوحة مهام عربية</h3>
                <p>القالب المدعوم في النسخة الأولى. ملفات مستقلة، بلا تبعيات أو حسابات.</p>
                <div>
                  <Check size={14} />
                  إضافة، إنجاز، وحذف المهام
                </div>
                <div>
                  <Check size={14} />
                  واجهة متجاوبة وحفظ محلي
                </div>
                <div>
                  <Check size={14} />
                  حزمة ZIP قابلة للتنزيل
                </div>
                <span className="template-limit">
                  محاكاة واضحة: وصفك يوثَّق، لكن كود القالب ثابت ولا يولّده نموذج.
                </span>
              </aside>
            </div>
            {formError && (
              <div className="form-error" role="alert">
                <AlertCircle size={16} />
                {formError}
              </div>
            )}
            <div className="modal-footer">
              <span>
                <ShieldCheck size={14} />
                لا نماذج مدفوعة. لا نشر تلقائي.
              </span>
              <div>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setShowCreate(false)}
                >
                  إلغاء
                </button>
                <button className="button primary" disabled={busy}>
                  {busy ? <LoaderCircle size={17} className="spin" /> : <Plus size={17} />}إنشاء
                  المشروع
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}
      {showHelp && (
        <Modal title="مرحبًا بك في المصنع" onClose={() => setShowHelp(false)}>
          <div className="help-content">
            <p>
              هذه النسخة هي الأساس العملي للمصنع: إدارة مشاريع وحفظ دائم وموافقات وملفات قابلة
              للتسليم.
            </p>
            <ol>
              <li>
                <strong>ابدأ بفكرة.</strong> أنشئ مشروعًا، أو استخدم مثال لوحة المهام.
              </li>
              <li>
                <strong>شغّل الرحلة.</strong> ابدأ التشغيل التجريبي من مساحة المشروع.
              </li>
              <li>
                <strong>راجع واعتمد.</strong> عدّل المتطلبات واحفظها، ثم وافق للمتابعة.
              </li>
              <li>
                <strong>تصفح النتيجة.</strong> راجع الملفات والمعاينة، ثم اعتمد التسليم ونزّل ZIP.
              </li>
            </ol>
            <div className="warning-banner">
              <AlertCircle size={19} />
              <p>
                لا يوجد نموذج ذكاء اصطناعي متصل حاليًا. القالب ثابت والفحوص بنيوية فقط. لا مصادقة في
                هذه المساحة، فلا تستخدم بيانات خاصة.
              </p>
            </div>
            <p className="small muted">
              تتقدم المحاكاة فقط عند فتح المشروع. تُحفظ الخطوات على الخادم ويمكن استئنافها لاحقًا.
            </p>
            <button
              className="button primary"
              onClick={() => {
                setShowHelp(false);
                openCreate(true);
              }}
            >
              لنجرّب أول مشروع
              <ArrowLeft size={16} />
            </button>
          </div>
        </Modal>
      )}
      {deleteTarget && (
        <Modal
          title="حذف المشروع؟"
          onClose={() => {
            if (!busy) setDeleteTarget(null);
          }}
        >
          <p className="modal-description">
            سيُحذف مشروع «{deleteTarget.name}» وجميع تشغيلاته وملفاته نهائيًا. لا يمكن التراجع عن
            هذا الإجراء.
          </p>
          <div className="delete-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setDeleteTarget(null)}
            >
              احتفظ بالمشروع
            </button>
            <button className="button danger" disabled={busy} onClick={() => void deleteProject()}>
              {busy ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}حذف نهائي
            </button>
          </div>
        </Modal>
      )}
      {showPreview && run?.artifacts['index.html'] && (
        <Modal title="معاينة قالب لوحة المهام" onClose={() => setShowPreview(false)} wide>
          <div className="preview-notice">
            <ShieldCheck size={15} />
            قالب ثابت في إطار معزول دون شبكة. المهام هنا مؤقتة، وقد لا يتاح الحفظ المحلي.
          </div>
          <iframe
            className="template-iframe"
            title="معاينة لوحة المهام"
            sandbox="allow-scripts allow-forms"
            referrerPolicy="no-referrer"
            srcDoc={run.artifacts['index.html']}
          />
        </Modal>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? 'toast-error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <AlertCircle size={19} /> : <Check size={19} />}
          <span>{toast.text}</span>
          <button className="icon-button" onClick={() => setToast(null)} aria-label="إغلاق الإشعار">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function EventList({ events }: { events: RunEvent[] }) {
  return events.length ? (
    <ol className="event-list">
      {events.map((event, i) => (
        <li key={event.id}>
          <div className={`event-dot ${i === 0 ? 'highlight' : ''}`} />
          <div>
            <p>{event.message}</p>
            <time dateTime={event.created_at}>{time(event.created_at)}</time>
          </div>
        </li>
      ))}
    </ol>
  ) : (
    <div className="panel-empty small-empty">
      <Activity size={25} />
      <p>سيظهر سجل الخطوات هنا بعد بدء التشغيل.</p>
    </div>
  );
}

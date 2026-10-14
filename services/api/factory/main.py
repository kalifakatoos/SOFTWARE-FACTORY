"""Persistent, deterministic workflow foundation. No LLM or shell execution.

This local single-workspace edition has no authentication. Never expose it as a
production/multi-tenant service. See docs/IMPLEMENTATION.ar.md for boundaries.
"""

from __future__ import annotations

import io
import json
import os
import sqlite3
import zipfile
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

ROOT = Path(__file__).resolve().parents[3]
TEMPLATE = ROOT / "packages/templates/taskboard.html"
TERMINAL = {"completed", "cancelled", "failed"}
AUTOMATIC = {"queued", "analyzing", "planning", "generating", "validating"}


def now() -> str:
    return datetime.now(UTC).isoformat()


class Input(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class ProjectInput(Input):
    name: str = Field(min_length=2, max_length=80)
    description: str = Field(min_length=20, max_length=4000)
    template: Literal["taskboard"] = "taskboard"


class VersionInput(Input):
    version: int = Field(ge=1)


class RequirementsInput(VersionInput):
    requirements: str = Field(min_length=20, max_length=12000)


def create_app(db_path: str | Path | None = None) -> FastAPI:
    path = Path(db_path or os.getenv("FACTORY_DB", str(ROOT / ".data/factory.sqlite3")))
    path.parent.mkdir(parents=True, exist_ok=True)
    app = FastAPI(title="Software Factory — local foundation", version="0.1.0")

    @contextmanager
    def db(write=False):
        conn = sqlite3.connect(path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            if write:
                conn.execute("BEGIN IMMEDIATE")
            yield conn
            if write:
                conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()

    with db(True) as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
            template TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
            requirements TEXT NOT NULL DEFAULT '', approved_version INTEGER,
            artifacts TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            idempotency_key TEXT NOT NULL, UNIQUE(project_id, idempotency_key)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS one_active_run ON runs(project_id)
            WHERE status NOT IN ('completed', 'cancelled', 'failed');
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            message TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS run_events ON events(run_id, id);
        PRAGMA user_version=1;
        """)

    # JSON mutations cannot be submitted through cross-site HTML forms. This is
    # defense-in-depth, not a substitute for production auth/CSRF protections.
    @app.middleware("http")
    async def request_policy(request: Request, call_next):
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            if request.headers.get("sec-fetch-site") == "cross-site":
                return JSONResponse({"detail": "الطلب من موقع خارجي غير مسموح."}, status_code=403)
            if (
                request.method != "DELETE"
                and request.headers.get("content-type", "").split(";")[0] != "application/json"
            ):
                return JSONResponse({"detail": "يجب إرسال الطلب بصيغة JSON."}, status_code=415)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    def project_or_404(conn, project_id):
        row = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "المشروع غير موجود.")
        return dict(row)

    def run_or_404(conn, run_id):
        row = conn.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "التشغيل غير موجود.")
        return dict(row)

    def serialize_run(conn, row):
        result = dict(row)
        result.pop("idempotency_key", None)
        result["artifacts"] = json.loads(result["artifacts"])
        result["events"] = [
            dict(e)
            for e in conn.execute(
                "SELECT id, message, created_at FROM events WHERE run_id=? ORDER BY id",
                (result["id"],),
            )
        ]
        result["provider"] = "deterministic-demo"
        result["model_calls"] = 0
        return result

    def event(conn, run_id, message):
        conn.execute(
            "INSERT INTO events(run_id,message,created_at) VALUES (?,?,?)",
            (run_id, message, now()),
        )

    def check_version(run, expected):
        if run["version"] != expected:
            raise HTTPException(409, "تغيرت حالة التشغيل. حدّث الصفحة ثم حاول مجددًا.")

    def transition(conn, run, status, message, **fields):
        # Field names are internal constants only; user input is parameterized.
        fields.update(status=status, version=run["version"] + 1, updated_at=now())
        columns = ", ".join(f"{key}=?" for key in fields)
        conn.execute(f"UPDATE runs SET {columns} WHERE id=?", (*fields.values(), run["id"]))
        event(conn, run["id"], message)
        return serialize_run(conn, run_or_404(conn, run["id"]))

    @app.get("/api/v1/health")
    def health():
        with db() as conn:
            conn.execute("SELECT 1")
        return {
            "status": "ok",
            "mode": "local-demo",
            "provider": "deterministic-demo",
            "authentication": False,
        }

    @app.get("/api/v1/projects")
    def list_projects():
        with db() as conn:
            projects = []
            for row in conn.execute("SELECT * FROM projects ORDER BY created_at DESC"):
                project = dict(row)
                run = conn.execute(
                    "SELECT id,status,version,updated_at FROM runs WHERE project_id=? ORDER BY created_at DESC LIMIT 1",
                    (project["id"],),
                ).fetchone()
                project["latest_run"] = dict(run) if run else None
                projects.append(project)
            return projects

    @app.post("/api/v1/projects", status_code=201)
    def create_project(data: ProjectInput):
        with db(True) as conn:
            if conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0] >= 100:
                raise HTTPException(409, "وصلت إلى حد النسخة المحلية: 100 مشروع.")
            project = {"id": uuid4().hex, **data.model_dump(), "created_at": now()}
            conn.execute(
                "INSERT INTO projects(id,name,description,template,created_at) VALUES (:id,:name,:description,:template,:created_at)",
                project,
            )
            return {**project, "latest_run": None}

    @app.get("/api/v1/projects/{project_id}")
    def get_project(project_id: str):
        with db() as conn:
            project = project_or_404(conn, project_id)
            project["runs"] = [
                serialize_run(conn, row)
                for row in conn.execute(
                    "SELECT * FROM runs WHERE project_id=? ORDER BY created_at DESC",
                    (project_id,),
                )
            ]
            return project

    @app.delete("/api/v1/projects/{project_id}", status_code=204)
    def delete_project(project_id: str):
        with db(True) as conn:
            project_or_404(conn, project_id)
            conn.execute("DELETE FROM projects WHERE id=?", (project_id,))
        return Response(status_code=204)

    @app.post("/api/v1/projects/{project_id}/runs", status_code=201)
    def create_run(project_id: str, idempotency_key: str = Header(min_length=8, max_length=128)):
        with db(True) as conn:
            project_or_404(conn, project_id)
            existing = conn.execute(
                "SELECT * FROM runs WHERE project_id=? AND idempotency_key=?",
                (project_id, idempotency_key),
            ).fetchone()
            if existing:
                return serialize_run(conn, existing)
            if conn.execute(
                "SELECT 1 FROM runs WHERE project_id=? AND status NOT IN ('completed','cancelled','failed')",
                (project_id,),
            ).fetchone():
                raise HTTPException(409, "هناك تشغيل نشط لهذا المشروع بالفعل.")
            if (
                conn.execute(
                    "SELECT COUNT(*) FROM runs WHERE project_id=?", (project_id,)
                ).fetchone()[0]
                >= 20
            ):
                raise HTTPException(409, "وصلت إلى حد النسخة المحلية: 20 تشغيلًا للمشروع.")
            run_id = uuid4().hex
            timestamp = now()
            conn.execute(
                "INSERT INTO runs(id,project_id,status,created_at,updated_at,idempotency_key) VALUES (?,?,'queued',?,?,?)",
                (run_id, project_id, timestamp, timestamp, idempotency_key),
            )
            event(
                conn,
                run_id,
                "تم إنشاء تشغيل تجريبي. لا يُستخدم نموذج ذكاء اصطناعي أو رصيد مدفوع.",
            )
            return serialize_run(conn, run_or_404(conn, run_id))

    @app.get("/api/v1/runs/{run_id}")
    def get_run(run_id: str):
        with db() as conn:
            return serialize_run(conn, run_or_404(conn, run_id))

    @app.post("/api/v1/runs/{run_id}/advance")
    def advance(run_id: str, data: VersionInput):
        with db(True) as conn:
            run = run_or_404(conn, run_id)
            check_version(run, data.version)
            project = project_or_404(conn, run["project_id"])
            status = run["status"]
            if status not in AUTOMATIC:
                raise HTTPException(409, "هذه المرحلة تحتاج قرارًا من المستخدم أو انتهى التشغيل.")
            if status == "queued":
                return transition(
                    conn,
                    run,
                    "analyzing",
                    "بدأ إعداد مسودة المتطلبات من وصفك وقالب لوحة المهام الثابت.",
                )
            if status == "analyzing":
                requirements = (
                    f"# {project['name']}\n\n## وصف الفكرة\n{project['description']}\n\n"
                    "## نطاق القالب التجريبي\n"
                    "- لوحة مهام عربية متجاوبة تعمل في المتصفح.\n"
                    "- إضافة مهمة وتحديدها كمكتملة وحذفها.\n"
                    "- حفظ المهام محليًا عند تشغيل الملف خارج المعاينة.\n"
                    "- لا تسجيل دخول أو مزامنة أو اتصال بخدمات خارجية.\n\n"
                    "## معايير القبول\n"
                    "- لا تُضاف مهمة فارغة.\n- يظهر عداد المهام المنجزة.\n"
                    "- تعرض أسماء المهام كنص ولا تنفذ HTML.\n\n"
                    "## قيد هذه النسخة\n"
                    "المخرجات قالب ثابت؛ تعديلات المتطلبات تحفظ للتوثيق فقط ولا تغير كود القالب. "
                    "لا يُنفذ تحليل أو توليد بالذكاء الاصطناعي في هذه المرحلة."
                )
                return transition(
                    conn,
                    run,
                    "awaiting_approval",
                    "المسودة جاهزة لمراجعتك. لن نكمل دون موافقتك.",
                    requirements=requirements,
                )
            if status == "planning":
                return transition(
                    conn,
                    run,
                    "generating",
                    "تم تحديد خطة ثابتة: توثيق المتطلبات، تجهيز قالب المهام، وفحص الحزمة.",
                )
            if status == "generating":
                artifacts = {
                    "requirements.md": run["requirements"],
                    "plan.md": "# خطة تجريبية\n\n1. استخدام قالب لوحة المهام الثابت.\n2. إرفاق المتطلبات المعتمدة.\n3. فحص بنية الملفات.\n4. مراجعة بشرية وتنزيل الحزمة.\n\nلا يتم تنفيذ كود مولّد أو تخصيص القالب بواسطة نموذج.\n",
                    "index.html": TEMPLATE.read_text(encoding="utf-8"),
                    "README.md": "# لوحة مهام — قالب Software Factory التجريبي\n\nافتح index.html في متصفح حديث. جميع الموارد مضمنة ولا توجد تبعيات.\nالمهام تحفظ محليًا في المتصفح إذا سمحت إعداداته بذلك؛ لا توجد مزامنة.\n\nالمتطلبات المرفقة وثيقة تخطيط فقط. القالب ثابت ولم يولّده نموذج.\nتقرير report.json فحص بنية حزمة، وليس اختبار تشغيل أو ضمان صلاحية للإنتاج.\n",
                }
                return transition(
                    conn,
                    run,
                    "validating",
                    "تم تجهيز قالب ثابت وثلاث وثائق. لم يتم استدعاء نموذج أو تنفيذ كود.",
                    artifacts=json.dumps(artifacts, ensure_ascii=False),
                )
            artifacts = json.loads(run["artifacts"])
            checks = [
                {
                    "name": "وجود الملفات المطلوبة",
                    "passed": all(
                        name in artifacts
                        for name in (
                            "index.html",
                            "requirements.md",
                            "plan.md",
                            "README.md",
                        )
                    ),
                },
                {
                    "name": "توثيق المتطلبات المعتمدة دون تغيير",
                    "passed": artifacts.get("requirements.md") == run["requirements"],
                },
                {
                    "name": "مطابقة القالب الثابت الموثوق",
                    "passed": artifacts.get("index.html") == TEMPLATE.read_text(encoding="utf-8"),
                },
            ]
            report = {
                "kind": "package-structure-only",
                "code_executed": False,
                "model_used": False,
                "checks": checks,
                "notice": "هذه فحوص بنية حزمة فقط، وليست اختبارات سلوكية للتطبيق.",
            }
            artifacts["report.json"] = json.dumps(report, ensure_ascii=False, indent=2)
            passed = all(c["passed"] for c in checks)
            return transition(
                conn,
                run,
                "awaiting_review" if passed else "failed",
                "انتهت فحوص بنية الحزمة. النتائج جاهزة للمراجعة البشرية."
                if passed
                else "فشل فحص بنية الحزمة.",
                artifacts=json.dumps(artifacts, ensure_ascii=False),
            )

    @app.put("/api/v1/runs/{run_id}/requirements")
    def edit_requirements(run_id: str, data: RequirementsInput):
        with db(True) as conn:
            run = run_or_404(conn, run_id)
            check_version(run, data.version)
            if run["status"] != "awaiting_approval":
                raise HTTPException(409, "يمكن تعديل المتطلبات قبل اعتمادها فقط.")
            return transition(
                conn,
                run,
                "awaiting_approval",
                "حُفظت نسخة جديدة من المتطلبات؛ بانتظار اعتمادها.",
                requirements=data.requirements,
            )

    @app.post("/api/v1/runs/{run_id}/approve-requirements")
    def approve_requirements(run_id: str, data: VersionInput):
        with db(True) as conn:
            run = run_or_404(conn, run_id)
            check_version(run, data.version)
            if run["status"] != "awaiting_approval":
                raise HTTPException(409, "المتطلبات ليست بانتظار الاعتماد.")
            return transition(
                conn,
                run,
                "planning",
                "اعتمد المستخدم نسخة المتطلبات الحالية.",
                approved_version=run["version"],
            )

    @app.post("/api/v1/runs/{run_id}/approve-delivery")
    def approve_delivery(run_id: str, data: VersionInput):
        with db(True) as conn:
            run = run_or_404(conn, run_id)
            check_version(run, data.version)
            if run["status"] != "awaiting_review":
                raise HTTPException(409, "يجب إكمال فحوص الحزمة قبل اعتماد التسليم.")
            return transition(
                conn,
                run,
                "completed",
                "اعتمد المستخدم تسليم الحزمة التجريبية. أصبحت متاحة للتنزيل.",
            )

    @app.post("/api/v1/runs/{run_id}/cancel")
    def cancel(run_id: str, data: VersionInput):
        with db(True) as conn:
            run = run_or_404(conn, run_id)
            check_version(run, data.version)
            if run["status"] in TERMINAL:
                raise HTTPException(409, "انتهى التشغيل بالفعل.")
            return transition(
                conn,
                run,
                "cancelled",
                "أوقف المستخدم التشغيل. لم تُنفّذ أي عمليات خارجية.",
            )

    @app.get("/api/v1/runs/{run_id}/download")
    def download(run_id: str):
        with db() as conn:
            run = run_or_404(conn, run_id)
            if run["status"] != "completed":
                raise HTTPException(409, "اعتمد التسليم أولًا لتنزيل الحزمة.")
            artifacts = json.loads(run["artifacts"])
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, content in artifacts.items():
                # Fixed allowlist, even if a future migration changes storage.
                if name in {
                    "index.html",
                    "requirements.md",
                    "plan.md",
                    "README.md",
                    "report.json",
                }:
                    archive.writestr(name, content)
        return Response(
            buffer.getvalue(),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="factory-{run_id[:8]}.zip"'},
        )

    return app


app = create_app()

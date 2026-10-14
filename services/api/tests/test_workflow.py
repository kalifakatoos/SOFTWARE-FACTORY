import io
import json
import zipfile
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from factory.main import create_app


@pytest.fixture
def db_path(tmp_path):
    return tmp_path / "factory.sqlite3"


@pytest.fixture
def client(db_path):
    with TestClient(create_app(db_path)) as client:
        yield client


def project(client, name="مشروعي الأول"):
    response = client.post(
        "/api/v1/projects",
        json={
            "name": name,
            "description": "لوحة مهام عربية لإضافة المهام وإنجازها مع حفظ محلي.",
        },
    )
    assert response.status_code == 201
    return response.json()


def start(client, project_id, key="test-idempotency-key"):
    response = client.post(
        f"/api/v1/projects/{project_id}/runs", json={}, headers={"Idempotency-Key": key}
    )
    assert response.status_code == 201
    return response.json()


def action(client, run, name="advance", **extra):
    response = client.post(
        f"/api/v1/runs/{run['id']}/{name}", json={"version": run["version"], **extra}
    )
    assert response.status_code == 200, response.text
    return response.json()


def awaiting_approval(client):
    run = start(client, project(client)["id"])
    run = action(client, run)
    run = action(client, run)
    assert run["status"] == "awaiting_approval"
    return run


def completed(client):
    run = awaiting_approval(client)
    run = action(client, run, "approve-requirements")
    for _ in range(3):
        run = action(client, run)
    assert run["status"] == "awaiting_review"
    return action(client, run, "approve-delivery")


def test_empty_space_and_health(client):
    assert client.get("/api/v1/projects").json() == []
    response = client.get("/api/v1/health")
    assert response.json()["authentication"] is False
    assert response.headers["cache-control"] == "no-store"


def test_complete_workflow_and_zip(client):
    run = completed(client)
    assert run["status"] == "completed"
    assert run["model_calls"] == 0
    assert run["provider"] == "deterministic-demo"
    assert len(run["events"]) == 8
    assert run["approved_version"] == 3
    report = json.loads(run["artifacts"]["report.json"])
    assert report["kind"] == "package-structure-only"
    assert report["code_executed"] is False
    assert report["model_used"] is False
    assert all(check["passed"] for check in report["checks"])
    response = client.get(f"/api/v1/runs/{run['id']}/download")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert set(archive.namelist()) == {
            "index.html",
            "README.md",
            "requirements.md",
            "plan.md",
            "report.json",
        }
        assert archive.read("requirements.md").decode() == run["requirements"]
        assert "Content-Security-Policy" in archive.read("index.html").decode()


def test_human_approval_cannot_be_skipped(client):
    run = awaiting_approval(client)
    assert (
        client.post(
            f"/api/v1/runs/{run['id']}/advance", json={"version": run["version"]}
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/v1/runs/{run['id']}/approve-delivery",
            json={"version": run["version"]},
        ).status_code
        == 409
    )
    assert client.get(f"/api/v1/runs/{run['id']}/download").status_code == 409


def test_approval_must_reference_current_version(client):
    run = awaiting_approval(client)
    content = "متطلبات جديدة معتمدة: لوحة مهام عربية تعمل محليًا دون إرسال بيانات."
    updated = client.put(
        f"/api/v1/runs/{run['id']}/requirements",
        json={"version": run["version"], "requirements": content},
    )
    assert updated.status_code == 200
    updated = updated.json()
    assert updated["version"] == run["version"] + 1
    assert (
        client.post(
            f"/api/v1/runs/{run['id']}/approve-requirements",
            json={"version": run["version"]},
        ).status_code
        == 409
    )
    approved = action(client, updated, "approve-requirements")
    assert approved["requirements"] == content
    assert approved["approved_version"] == updated["version"]
    assert (
        client.put(
            f"/api/v1/runs/{run['id']}/requirements",
            json={"version": approved["version"], "requirements": content},
        ).status_code
        == 409
    )


def test_stale_advance_does_not_duplicate_events(client):
    run = start(client, project(client)["id"])
    updated = action(client, run)
    assert (
        client.post(
            f"/api/v1/runs/{run['id']}/advance", json={"version": run["version"]}
        ).status_code
        == 409
    )
    assert client.get(f"/api/v1/runs/{run['id']}").json()["events"] == updated["events"]


def test_idempotency_and_only_one_active_run(client):
    p = project(client)
    original = start(client, p["id"])
    assert start(client, p["id"])["id"] == original["id"]
    response = client.post(
        f"/api/v1/projects/{p['id']}/runs",
        json={},
        headers={"Idempotency-Key": "different-key"},
    )
    assert response.status_code == 409
    action(client, original, "cancel")
    new = start(client, p["id"], "third-request-key")
    assert new["id"] != original["id"]
    assert start(client, p["id"])["id"] == original["id"]


def test_cancel_prevents_further_transitions(client):
    run = awaiting_approval(client)
    run = action(client, run, "cancel")
    assert run["status"] == "cancelled"
    for endpoint in ("advance", "approve-requirements", "approve-delivery", "cancel"):
        response = client.post(
            f"/api/v1/runs/{run['id']}/{endpoint}", json={"version": run["version"]}
        )
        assert response.status_code == 409


def test_terminal_delivery_cannot_be_cancelled_or_reapproved(client):
    run = completed(client)
    for endpoint in ("cancel", "approve-delivery", "advance"):
        assert (
            client.post(
                f"/api/v1/runs/{run['id']}/{endpoint}", json={"version": run["version"]}
            ).status_code
            == 409
        )


def test_state_survives_new_app_instance(client, db_path):
    run = awaiting_approval(client)
    with TestClient(create_app(db_path)) as restarted:
        restored = restarted.get(f"/api/v1/runs/{run['id']}").json()
        assert restored == run
        assert action(restarted, restored, "approve-requirements")["status"] == "planning"


def test_deletion_cascades_runs_and_artifacts(client):
    run = completed(client)
    assert client.delete(f"/api/v1/projects/{run['project_id']}").status_code == 204
    assert client.get(f"/api/v1/runs/{run['id']}").status_code == 404
    assert client.get(f"/api/v1/runs/{run['id']}/download").status_code == 404
    assert client.get("/api/v1/projects").json() == []


@pytest.mark.parametrize(
    "payload",
    [
        {"name": "x", "description": "وصف قصير"},
        {"name": "  ", "description": "وصف طويل بما يكفي لكنه بلا اسم مشروع صالح"},
        {"name": "مشروع", "description": "   "},
        {"name": "مشروع", "description": "a" * 4001},
        {"name": "مشروع", "description": "a" * 30, "template": "arbitrary-code"},
        {"name": "مشروع", "description": "a" * 30, "status": "completed"},
    ],
)
def test_invalid_project_input_rejected(client, payload):
    assert client.post("/api/v1/projects", json=payload).status_code == 422
    assert client.get("/api/v1/projects").json() == []


def test_content_type_and_cross_site_policy(client):
    assert client.post("/api/v1/projects", data={"name": "untrusted"}).status_code == 415
    assert (
        client.post(
            "/api/v1/projects", json={}, headers={"Sec-Fetch-Site": "cross-site"}
        ).status_code
        == 403
    )
    assert (
        client.delete(
            "/api/v1/projects/not-present", headers={"Sec-Fetch-Site": "cross-site"}
        ).status_code
        == 403
    )


def test_missing_ids_and_missing_idempotency_key(client):
    assert client.get("/api/v1/projects/not-present").status_code == 404
    assert client.get("/api/v1/runs/not-present").status_code == 404
    p = project(client)
    assert client.post(f"/api/v1/projects/{p['id']}/runs", json={}).status_code == 422


def test_user_text_is_not_interpolated_into_executable_template(client):
    p = project(client, "<script>alert(1)</script>")
    run = start(client, p["id"])
    for _ in range(2):
        run = action(client, run)
    run = action(client, run, "approve-requirements")
    for _ in range(3):
        run = action(client, run)
    assert p["name"] not in run["artifacts"]["index.html"]
    assert p["name"] in run["artifacts"]["requirements.md"]


def test_simultaneous_start_is_serialized(client):
    p = project(client)

    def request(index):
        return client.post(
            f"/api/v1/projects/{p['id']}/runs",
            json={},
            headers={"Idempotency-Key": f"concurrent-{index}"},
        ).status_code

    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(request, range(4)))
    assert sorted(results) == [201, 409, 409, 409]


def test_simultaneous_advance_has_one_winner(client):
    run = start(client, project(client)["id"])

    def request(_):
        return client.post(
            f"/api/v1/runs/{run['id']}/advance", json={"version": run["version"]}
        ).status_code

    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(request, range(4)))
    assert sorted(results) == [200, 409, 409, 409]
    assert len(client.get(f"/api/v1/runs/{run['id']}").json()["events"]) == 2

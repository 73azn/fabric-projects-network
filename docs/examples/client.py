"""Minimal client for the projects API. Python 3.8+, standard library only.

    python docs/examples/client.py [base-url]        runs a short demo
or: from client import ProjectsClient
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


class ApiError(Exception):
    def __init__(self, status, code, message):
        super().__init__(f"HTTP {status} {code}: {message}")
        self.status = status   # 400, 403, 404, 409, 503 ...
        self.code = code       # INVALID_INPUT, FORBIDDEN, NOT_FOUND, ALREADY_EXISTS, ...


class ProjectsClient:
    def __init__(self, base_url="http://localhost:4000", org="platform"):
        self.base_url = base_url
        self.org = org  # 'platform' can read and write, 'admin' can only read

    def _request(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        headers = {"X-Org": self.org}
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base_url + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as res:
                return json.load(res)
        except urllib.error.HTTPError as err:
            payload = json.load(err)
            raise ApiError(err.code, payload.get("code"), payload.get("error")) from None

    def create_project(self, project):      return self._request("POST", "/projects", project)
    def get_project(self, id):              return self._request("GET", f"/projects/{urllib.parse.quote(id)}")
    def update_project(self, id, project):  return self._request("PUT", f"/projects/{urllib.parse.quote(id)}", project)
    def add_payment(self, id, payment):     return self._request("POST", f"/projects/{urllib.parse.quote(id)}/payments", payment)
    def get_history(self, id):              return self._request("GET", f"/projects/{urllib.parse.quote(id)}/history")
    def health(self):                       return self._request("GET", "/health")


if __name__ == "__main__":
    api = ProjectsClient(sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4000")
    pid = f"PRJ-DEMO-PY-{int(time.time())}"

    api.create_project({"id": pid, "owner": "Omar", "contractor": "Rimal Co.", "agreedPrice": 20000,
                        "milestone": [{"description": "Excavation", "startDate": "2026-10-08", "finishDate": None}]})
    api.add_payment(pid, {"id": "PAY-1", "amount": 5000, "date": "2026-10-09", "note": "deposit"})
    p = api.get_project(pid)
    print(f"{p['id']}: paid {p['totalPaid']} of {p['agreedPrice']}, remaining {p['remaining']}")
    print("versions on the ledger:", len(api.get_history(pid)))

    try:
        api.create_project({"id": pid, "owner": "x", "contractor": "y", "agreedPrice": 1})
    except ApiError as e:
        print("duplicate id ->", e)
    try:
        ProjectsClient(api.base_url, "admin").add_payment(pid, {"id": "PAY-2", "amount": 1, "date": "2026-10-10"})
    except ApiError as e:
        print("admin write  ->", e)

from __future__ import annotations

import json
import os
from typing import Any
from urllib import request


class ApiClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def get_json(self, path: str) -> Any:
        with request.urlopen(f"{self.base_url}{path}") as response:
            return json.loads(response.read().decode("utf-8"))

    def post_json(self, path: str, payload: dict[str, Any]) -> Any:
        encoded = json.dumps(payload).encode("utf-8")
        req = request.Request(
            f"{self.base_url}{path}",
            data=encoded,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(req) as response:
            return json.loads(response.read().decode("utf-8"))

    def download_file(self, url: str, destination: str, headers: dict[str, str] | None = None) -> str:
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        req = request.Request(url, headers=headers or {}, method="GET")
        with request.urlopen(req) as response, open(destination, "wb") as handle:
            handle.write(response.read())
        return destination

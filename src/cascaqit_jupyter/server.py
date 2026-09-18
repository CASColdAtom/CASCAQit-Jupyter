"""Authenticated workbench capabilities and offline template endpoints."""

from __future__ import annotations

from importlib.util import find_spec
from typing import Any

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
from tornado import web

from cascaqit_jupyter.ide import code_binary, configure_workspace
from cascaqit_jupyter.templates import create_template


class WorkbenchHandler(APIHandler):
    @web.authenticated
    def get(self) -> None:
        proxy = self.settings.get("cascaqit_proxy_enabled", False)
        self.finish(
            {
                "code_available": bool(proxy and code_binary()),
                "root": self.settings["cascaqit_workspace_root"],
                "lsp": find_spec("pylsp") is not None,
                "git": find_spec("jupyterlab_git") is not None,
            }
        )


class TemplateHandler(APIHandler):
    @web.authenticated
    def get(self, kind: str) -> None:
        if kind not in {"digital", "analog"}:
            raise web.HTTPError(404)
        self.finish(create_template(kind))


def _load_jupyter_server_extension(serverapp: Any) -> None:
    configure_workspace(serverapp.root_dir)
    settings = serverapp.web_app.settings
    settings["cascaqit_workspace_root"] = serverapp.root_dir
    settings["cascaqit_proxy_enabled"] = bool(
        serverapp.jpserver_extensions.get("jupyter_server_proxy", False)
    )
    base = settings["base_url"]
    serverapp.web_app.add_handlers(
        ".*$",
        [
            (url_path_join(base, "cascaqit/workbench"), WorkbenchHandler),
            (
                url_path_join(base, "cascaqit/templates/(digital|analog)"),
                TemplateHandler,
            ),
        ],
    )


def _jupyter_server_extension_points() -> list[dict[str, str]]:
    return [{"module": "cascaqit_jupyter.server"}]

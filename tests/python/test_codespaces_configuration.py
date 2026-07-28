from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEVCONTAINER = ROOT / ".devcontainer"


def test_devcontainer_installs_and_starts_jupyterlab() -> None:
    config = json.loads((DEVCONTAINER / "devcontainer.json").read_text())

    assert config["postCreateCommand"] == "bash .devcontainer/post-create.sh"
    assert config["postStartCommand"] == "bash .devcontainer/start-jupyter.sh"
    assert config["forwardPorts"] == [8888]
    assert config["portsAttributes"]["8888"]["onAutoForward"] == "notify"
    core_permissions = config["customizations"]["codespaces"]["repositories"]
    assert core_permissions == {
        "CASColdAtom/CASCAQit": {"permissions": {"contents": "read"}}
    }


def test_codespaces_installation_pins_and_verifies_the_core_wheel() -> None:
    script = (DEVCONTAINER / "post-create.sh").read_text()

    assert 'CASCAQIT_VERSION="1.0.5a0"' in script
    expected_name = (
        'CASCAQIT_WHEEL_NAME="cascaqit-${CASCAQIT_VERSION}-py3-none-any.whl"'
    )
    assert expected_name in script
    assert 'CASCAQIT_REPOSITORY="CASColdAtom/CASCAQit"' in script
    assert 'CASCAQIT_RELEASE="v1.0.5a"' in script
    assert "gh release download" in script
    assert (
        "af665bcd8dc81d7afe1370c1acee656dcc3192b63552429692655dc0159ee97e"
        in script
    )
    assert "sha256sum --check" in script


def test_codespaces_keeps_jupyter_authentication_enabled() -> None:
    script = (DEVCONTAINER / "start-jupyter.sh").read_text()

    assert "--ip=0.0.0.0" in script
    assert "--port=\"${PORT}\"" in script
    assert "ServerApp.token" not in script
    assert "IdentityProvider.token" not in script


def test_internal_ci_requires_a_dedicated_core_token() -> None:
    workflow = (
        ROOT / ".github" / "workflows" / "codespaces-environment.yml"
    ).read_text()

    assert "workflow_dispatch:" in workflow
    assert "CASCAQIT_CORE_TOKEN" in workflow
    assert "push:" not in workflow

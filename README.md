# CASCAQit Jupyter

CASCAQit-Jupyter is the planned JupyterLab 4 and Notebook 7 integration for the CASCAQit neutral-atom quantum programming SDK. It will combine a Python kernel companion with a prebuilt JupyterLab extension for program rendering, local execution, Digital circuit editing, Analog register and waveform editing, and result analysis.

The repository is currently in planning and bootstrap status. It does not yet contain an installable Python package or JupyterLab extension and must not be described as a working notebook integration.

The implementation will consume released public CASCAQit APIs only. It will not import `cascaqit._internal`, depend on `cascaqit-compat`, copy simulator code, contact live hardware or CASCAQit Cloud, or depend on CASCAQit-Skills.

"""Transparent Python span collector (MVP).

Imported automatically via sitecustomize.py when PYTHONPATH includes the shim
dir. Uses sys.addaudithook (unremovable, low overhead) plus light wrappers for
subprocess / os.system so command lines are captured in full.

Writes NDJSON with os.write to $BB_TRACE_DIR/python-<pid>.ndjson. Never raises:
any failure disables tracing silently so user code keeps running.
"""
from __future__ import annotations

import json
import os
import sys
import time

_TRUNC_CMD = 2000
_TRUNC_FILE = 1000
_MAX_LINE = 8192

_fd = None
_in_emit = False
_in_hook = False
_thread_id = ""
_trace_dir = ""


def _trunc(s, n):
    try:
        s = str(s)
    except Exception:
        return "<unrepr>"
    return s if len(s) <= n else s[:n] + "…<%d>" % len(s)


def _emit(ev, **fields):
    global _fd, _in_emit
    if _fd is None:
        return
    if _in_emit:
        return
    _in_emit = True
    try:
        rec = {
            "ts_ns": time.time_ns(),
            "pid": os.getpid(),
            "ppid": _ppid(),
            "rt": "python",
            "ev": ev,
            "thread": _thread_id,
        }
        rec.update(fields)
        line = (json.dumps(rec, default=str) + "\n").encode("utf-8")[:_MAX_LINE]
        os.write(_fd, line)
    except Exception:
        pass
    finally:
        _in_emit = False


def _ppid():
    try:
        return os.getppid()
    except Exception:
        return -1


def _audit_hook(event, args):
    # Audit events we care about for profiling. Everything else ignored.
    # open: (path, mode, flags) ; os.open similar ; socket: (host, port)
    # os.system: (command,) ; os.exec*: (path, args) ; subprocess.Popen: varies
    global _in_hook
    if _in_hook:
        return
    _in_hook = True
    try:
        if event == "open":
            p = str(args[0]) if args else ""
            if "__pycache__" in p or p.endswith(".pyc"):
                return
            _emit("file.open", path=_trunc(p, _TRUNC_FILE))
        elif event in ("os.open", "os.listdir", "os.stat", "os.scandir"):
            _emit("file." + event.replace("os.", "os_"),
                  path=_trunc(args[0] if args else "", _TRUNC_FILE))
        elif event in ("os.system",):
            _emit("proc.system", cmd=_trunc(args[0] if args else "", _TRUNC_CMD))
        elif event.startswith("os.exec") or event.startswith("os.spawn"):
            _emit("proc.exec", event=event,
                  cmd=_trunc(" ".join(str(a) for a in (args[1] if len(args) > 1 else args)), _TRUNC_CMD))
        elif event.startswith("subprocess.Popen"):
            _emit("proc.popen", event=event,
                  cmd=_trunc(" ".join(str(a) for a in args), _TRUNC_CMD))
        elif event.startswith("socket."):
            _emit("net." + event.replace("socket.", ""),
                  detail=_trunc(" ".join(str(a) for a in args), 500))
    finally:
        _in_hook = False


def _wrap_subprocess():
    try:
        import subprocess as sp
    except Exception:
        return
    if getattr(sp.Popen, "_bb_traced", False):
        return
    _OrigPopen = sp.Popen

    class _TracedPopen(_OrigPopen):
        def __init__(self, *a, **k):
            cmd = a[0] if a else k.get("args", "")
            if isinstance(cmd, (list, tuple)):
                cmd_s = " ".join(str(c) for c in cmd)
            else:
                cmd_s = str(cmd)
            _emit("proc.spawn", cmd=_trunc(cmd_s, _TRUNC_CMD))
            super().__init__(*a, **k)

    _TracedPopen._bb_traced = True
    sp.Popen = _TracedPopen  # type: ignore


def _wrap_os_system():
    try:
        _orig = os.system
    except Exception:
        return
    if getattr(_orig, "_bb_traced", False):
        return

    def _traced(cmd):
        _emit("proc.system", cmd=_trunc(cmd, _TRUNC_CMD))
        return _orig(cmd)

    _traced._bb_traced = True  # type: ignore
    os.system = _traced  # type: ignore


def install():
    global _fd, _thread_id, _trace_dir
    if os.environ.get("BB_TRACE_ACTIVE_PY"):
        return
    os.environ["BB_TRACE_ACTIVE_PY"] = "1"
    _thread_id = os.environ.get("BB_THREAD_ID", "")
    _trace_dir = os.environ.get("BB_TRACE_DIR", "")
    if not _trace_dir:
        return
    try:
        os.makedirs(_trace_dir, exist_ok=True)
        path = os.path.join(_trace_dir, "python-%d.ndjson" % os.getpid())
        _fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    except Exception:
        _fd = None
        return
    try:
        sys.addaudithook(_audit_hook)
    except Exception:
        pass
    try:
        _wrap_subprocess()
    except Exception:
        pass
    try:
        _wrap_os_system()
    except Exception:
        pass
    _emit("proc.start",
           argv=_trunc(" ".join(sys.argv), _TRUNC_CMD),
           exe=_trunc(sys.executable, 500))

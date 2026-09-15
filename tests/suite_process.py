"""Own one suite's process tree and temporary files, including on cancellation.

Windows uses a Job Object assigned before the child can start test code. POSIX
uses a new process group. Neither cleanup path enumerates unrelated processes.
"""
from __future__ import annotations

import ctypes
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time


def remove_scratch(directory: Path):
    """Remove an owned temporary tree, including Windows read-only copies.

    copytree preserves source directory attributes. Only clear READONLY on an
    actual permission failure inside this temporary root; never chmod source
    assets, follow junctions, or hide other cleanup failures.
    """
    root = directory.resolve()

    def on_error(function, name, error):
        path = Path(name)
        if not isinstance(error, PermissionError) or os.name != "nt":
            raise error
        info = path.lstat()
        if (not path.resolve().is_relative_to(root)
                or info.st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT
                or not info.st_file_attributes & stat.FILE_ATTRIBUTE_READONLY):
            raise error
        path.chmod(stat.S_IWRITE)
        function(name)

    for attempt in range(30):
        try:
            if sys.version_info >= (3, 12):
                shutil.rmtree(directory, onexc=on_error)
            else:
                shutil.rmtree(directory, onerror=lambda fn, name, exc: on_error(fn, name, exc[1]))
            return
        except FileNotFoundError:
            return
        except OSError:
            if attempt == 29:
                raise
            time.sleep(0.1)


class WindowsJob:
    def __init__(self):
        from ctypes import wintypes as w

        class BasicLimits(ctypes.Structure):
            _fields_ = [("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64),
                        ("flags", w.DWORD), ("min_working_set", ctypes.c_size_t),
                        ("max_working_set", ctypes.c_size_t), ("active_processes", w.DWORD),
                        ("affinity", ctypes.c_size_t), ("priority", w.DWORD), ("scheduling", w.DWORD)]

        class IoCounters(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in ("read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes")]

        class Limits(ctypes.Structure):
            _fields_ = [("basic", BasicLimits), ("io", IoCounters),
                        ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
                        ("peak_process_memory", ctypes.c_size_t), ("peak_job_memory", ctypes.c_size_t)]

        class Accounting(ctypes.Structure):
            _fields_ = [(name, ctypes.c_int64) for name in ("user_time", "kernel_time", "period_user", "period_kernel")] + [
                (name, w.DWORD) for name in ("page_faults", "total", "active", "terminated")]

        self.accounting_type = Accounting

        self.api = ctypes.WinDLL("kernel32", use_last_error=True)
        for name, args, result in (
            ("CreateJobObjectW", [ctypes.c_void_p, w.LPCWSTR], w.HANDLE),
            ("SetInformationJobObject", [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD], w.BOOL),
            ("OpenProcess", [w.DWORD, w.BOOL, w.DWORD], w.HANDLE),
            ("AssignProcessToJobObject", [w.HANDLE, w.HANDLE], w.BOOL),
            ("TerminateJobObject", [w.HANDLE, w.UINT], w.BOOL),
            ("QueryInformationJobObject", [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD, ctypes.c_void_p], w.BOOL),
            ("WaitForSingleObject", [w.HANDLE, w.DWORD], w.DWORD),
            ("CloseHandle", [w.HANDLE], w.BOOL),
        ):
            function = getattr(self.api, name)
            function.argtypes, function.restype = args, result
        self.handle = self.api.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        limits = Limits()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.api.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            error = ctypes.WinError(ctypes.get_last_error())
            self.close()
            raise error

    def assign(self, pid):
        handle = self.api.OpenProcess(0x0100 | 0x0001, False, pid)  # SET_QUOTA | TERMINATE
        if not handle:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            if not self.api.AssignProcessToJobObject(self.handle, handle):
                raise ctypes.WinError(ctypes.get_last_error())
        finally:
            self.api.CloseHandle(handle)

    def close(self):
        if self.handle:
            process_handles = []
            try:
                # ActiveProcesses can reach zero before Windows has finished
                # process rundown. Wait on the processes themselves too, so open
                # log files and sockets have been released when cleanup returns.
                capacity = 64
                while True:
                    data = ctypes.create_string_buffer(8 + capacity * ctypes.sizeof(ctypes.c_size_t))
                    if self.api.QueryInformationJobObject(self.handle, 3, data, len(data), None):
                        break
                    if ctypes.get_last_error() != 234:  # ERROR_MORE_DATA
                        raise ctypes.WinError(ctypes.get_last_error())
                    capacity *= 2
                count = ctypes.c_uint32.from_buffer(data, 4).value
                for pid in (ctypes.c_size_t * count).from_buffer(data, 8):
                    process = self.api.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
                    if process:
                        process_handles.append(process)
                    elif ctypes.get_last_error() != 87:  # Already exited
                        raise ctypes.WinError(ctypes.get_last_error())
                if not self.api.TerminateJobObject(self.handle, 130):
                    raise ctypes.WinError(ctypes.get_last_error())
                deadline = time.monotonic() + 10
                while True:
                    accounting = self.accounting_type()
                    if not self.api.QueryInformationJobObject(self.handle, 1, ctypes.byref(accounting), ctypes.sizeof(accounting), None):
                        raise ctypes.WinError(ctypes.get_last_error())
                    if not accounting.active:
                        break
                    if time.monotonic() >= deadline:
                        raise TimeoutError("Windows suite process tree did not terminate")
                    time.sleep(0.01)
                for process in process_handles:
                    if self.api.WaitForSingleObject(process, max(0, int((deadline - time.monotonic()) * 1000))) != 0:
                        raise TimeoutError("Windows suite process did not finish cleanup")
            finally:
                for process in process_handles:
                    self.api.CloseHandle(process)
                self.api.CloseHandle(self.handle)
                self.handle = None


# The child waits for its parent's go-ahead. In particular it cannot spawn Chrome,
# PostgreSQL or Node in the gap before Windows assigns the Job Object.
BOOTSTRAP = """import os, runpy, sys
if sys.stdin.buffer.read(1) != b'1':
    raise SystemExit(2)
sys.stdin.close()
sys.stdin = open(os.devnull)
path = sys.argv[1]
sys.argv = [path]
sys.path.insert(0, os.path.dirname(path))
runpy.run_path(path, run_name='__main__')
"""


class SuiteProcess:
    def __init__(self, path: Path, log_path: Path, *, cwd: Path):
        self.closed = False
        self.proc = None
        self.job = None
        self.log = None
        self.scratch = Path(tempfile.mkdtemp(prefix="nv-"))
        self.started = time.monotonic()
        try:
            self.log = log_path.open("w", encoding="utf-8")
            if os.name == "nt":
                self.job = WindowsJob()
            self.proc = subprocess.Popen(
                [sys.executable, "-u", "-c", BOOTSTRAP, str(path)], cwd=cwd,
                stdin=subprocess.PIPE, stdout=self.log, stderr=subprocess.STDOUT,
                start_new_session=os.name != "nt",
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
                env={**os.environ, "PYTHONUTF8": "1", "PYTHONUNBUFFERED": "1",
                     "TMP": str(self.scratch), "TEMP": str(self.scratch), "TMPDIR": str(self.scratch)},
            )
            if self.job:
                self.job.assign(self.proc.pid)
            self.proc.stdin.write(b"1")
            self.proc.stdin.flush()
            self.proc.stdin.close()
        except BaseException:
            self.close()
            raise

    def poll(self):
        return self.proc.poll()

    def close(self):
        if self.closed:
            return
        try:
            if self.job:
                self.job.close()
            elif self.proc and os.name != "nt":
                try:
                    os.killpg(self.proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        finally:
            try:
                if self.proc:
                    if self.proc.poll() is None:
                        self.proc.kill()
                    self.proc.wait(timeout=10)
            finally:
                if self.proc and self.proc.stdin and not self.proc.stdin.closed:
                    self.proc.stdin.close()
                if self.log:
                    self.log.close()
        remove_scratch(self.scratch)
        self.closed = True

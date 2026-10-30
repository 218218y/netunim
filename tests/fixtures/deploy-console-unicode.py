"""Exercise the real deployment display fragment in an owned hidden OEM console."""
import ctypes
from ctypes import wintypes
import json
from pathlib import Path
import subprocess
import sys


def child(directory, display):
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    class Coord(ctypes.Structure):
        _fields_ = [('X', wintypes.SHORT), ('Y', wintypes.SHORT)]
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.SetConsoleCursorPosition.argtypes = [wintypes.HANDLE, Coord]
    kernel.FillConsoleOutputCharacterW.argtypes = [wintypes.HANDLE, wintypes.WCHAR, wintypes.DWORD, Coord, ctypes.POINTER(wintypes.DWORD)]
    kernel.ReadConsoleOutputCharacterW.argtypes = [wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, Coord, ctypes.POINTER(wintypes.DWORD)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.CreateFileW('CONOUT$', 0xC0000000, 3, None, 3, 0, None)
    assert handle != ctypes.c_void_p(-1).value
    try:
        assert kernel.SetConsoleOutputCP(862)
        message = 'Cloudflare: שלום — נתיב משתמש יעקב ☁'
        log = directory/'wrangler-output.txt'
        log.write_bytes(message.encode('utf8'))
        readings = []
        for command in (['cmd', '/d', '/c', 'type', str(log)], ['cmd', '/d', '/c', 'call', str(display)]):
            count = wintypes.DWORD()
            assert kernel.FillConsoleOutputCharacterW(handle, ' ', 512, Coord(0, 0), ctypes.byref(count))
            assert kernel.SetConsoleCursorPosition(handle, Coord(0, 0))
            with open('CONOUT$', 'w', encoding='utf8') as output:
                subprocess.run(command, stdout=output, stderr=output, stdin=subprocess.DEVNULL, check=True, timeout=10)
            buffer = ctypes.create_unicode_buffer(513)
            assert kernel.ReadConsoleOutputCharacterW(handle, buffer, 512, Coord(0, 0), ctypes.byref(count))
            readings.append(buffer.value.rstrip())
        (directory/'console-result.json').write_text(json.dumps({
            'codepage': 862, 'expected': message, 'previous_TYPE': readings[0], 'actual_display': readings[1],
            'previousExact': readings[0] == message, 'correctedExact': readings[1] == message},
            ensure_ascii=False, indent=2), encoding='utf8')
    finally:
        kernel.CloseHandle(handle)


def main():
    directory = Path(sys.argv[1])
    if sys.argv[2] == '--child':
        child(directory, Path(sys.argv[3]))
        return
    source = Path(sys.argv[2]).read_text(encoding='utf8')
    start = source.index('set "DEPLOY_EXIT=%ERRORLEVEL%"')
    fragment = source[start:source.index('\npopd', start)]
    display = directory/'actual-log-display.bat'
    display.write_text('@echo off\nsetlocal\nset "DEPLOY_WORK_DIR='+str(directory)+'"\n'+fragment+'\nexit /b 0\n',
                       encoding='utf8', newline='\r\n')
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = subprocess.SW_HIDE
    subprocess.run([sys.executable, __file__, str(directory), '--child', str(display)],
                   creationflags=subprocess.CREATE_NEW_CONSOLE, startupinfo=startup, check=True, timeout=20)
    report = json.loads((directory/'console-result.json').read_text(encoding='utf8'))
    assert report['previousExact'] is False and report['correctedExact'] is True, report
    print('PASS real deployment display in hidden CP862 console preserves Hebrew and Unicode')


if __name__ == '__main__':
    main()

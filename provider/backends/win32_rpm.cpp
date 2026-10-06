#include "win32_rpm.hpp"
#include <TlHelp32.h>

namespace byom {

Win32RpmMemory::Win32RpmMemory(DWORD pid) {
  handle_ = OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, FALSE, pid);
}
Win32RpmMemory::~Win32RpmMemory() {
  if (handle_) CloseHandle(handle_);
}
bool Win32RpmMemory::ok() const { return handle_ != nullptr; }

bool Win32RpmMemory::read(u64 address, void* dst, std::size_t size) {
  if (!handle_ || !dst || !size) return false;
  SIZE_T got = 0;
  return ReadProcessMemory(handle_, reinterpret_cast<LPCVOID>(address), dst, size, &got) && got == size;
}

u64 Win32RpmMemory::module_base(const char* module_name) {
  if (!handle_ || !module_name) return 0;
  DWORD pid = GetProcessId(handle_);
  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid);
  if (snap == INVALID_HANDLE_VALUE) return 0;
  MODULEENTRY32W me{};
  me.dwSize = sizeof(me);
  u64 base = 0;
  if (Module32FirstW(snap, &me)) {
    do {
      char name[MAX_PATH]{};
      WideCharToMultiByte(CP_UTF8, 0, me.szModule, -1, name, MAX_PATH, nullptr, nullptr);
      if (_stricmp(name, module_name) == 0) {
        base = reinterpret_cast<u64>(me.modBaseAddr);
        break;
      }
    } while (Module32NextW(snap, &me));
  }
  CloseHandle(snap);
  return base;
}

DWORD Win32RpmMemory::find_pid(const wchar_t* exe_name) {
  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snap == INVALID_HANDLE_VALUE) return 0;
  PROCESSENTRY32W pe{};
  pe.dwSize = sizeof(pe);
  DWORD pid = 0;
  if (Process32FirstW(snap, &pe)) {
    do {
      if (_wcsicmp(pe.szExeFile, exe_name) == 0) {
        pid = pe.th32ProcessID;
        break;
      }
    } while (Process32NextW(snap, &pe));
  }
  CloseHandle(snap);
  return pid;
}

} // namespace byom

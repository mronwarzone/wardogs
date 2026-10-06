#pragma once
#include "../include/memory.hpp"
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <Windows.h>

namespace byom {

/** Example backend: classic user-mode RPM. Swap this out for your own layer. */
class Win32RpmMemory final : public IMemory {
public:
  explicit Win32RpmMemory(DWORD pid);
  ~Win32RpmMemory() override;
  bool ok() const;
  bool read(u64 address, void* dst, std::size_t size) override;
  u64 module_base(const char* module_name) override;
  static DWORD find_pid(const wchar_t* exe_name);

private:
  HANDLE handle_ = nullptr;
};

} // namespace byom

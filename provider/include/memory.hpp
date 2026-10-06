#pragma once
#include <cstdint>
#include <cstddef>
#include <cstring>
#include <vector>

namespace byom {

using u64 = std::uint64_t;
using u32 = std::uint32_t;
using u8  = std::uint8_t;

struct Vec3 {
  double x = 0, y = 0, z = 0;
};

/** Plug your reader in here. DMA, RPM, driver, remote agent, whatever. */
class IMemory {
public:
  virtual ~IMemory() = default;

  /** Read `size` bytes from process virtual address `address` into `dst`. */
  virtual bool read(u64 address, void* dst, std::size_t size) = 0;

  /** Optional: module base for the game EXE. Return 0 if unknown. */
  virtual u64 module_base(const char* /*module_name*/) { return 0; }

  /** Optional batch. Default = serial reads. Override if your layer has scatter. */
  virtual bool read_many(const u64* addrs, void* const* dsts, const std::size_t* sizes, std::size_t count) {
    for (std::size_t i = 0; i < count; ++i) {
      if (!read(addrs[i], dsts[i], sizes[i])) return false;
    }
    return true;
  }

  template <typename T>
  bool read_t(u64 address, T& out) {
    return read(address, &out, sizeof(T));
  }

  bool read_ptr(u64 address, u64& out) { return read_t(address, out); }
};

inline bool user_ptr(u64 p) {
  return p >= 0x10000ULL && p <= 0x00007FFFFFFFFFFFULL;
}

} // namespace byom

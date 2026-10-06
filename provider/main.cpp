#include "radar.hpp"
#include "memory.hpp"
#include "backends/win32_rpm.hpp"

#include <cstdio>
#include <cstdlib>
#include <thread>
#include <chrono>

using namespace byom;

/*
 * Plug-in point:
 *   1. Replace Win32RpmMemory with YOUR IMemory implementation.
 *   2. Set process name / module name for your build.
 *   3. Keep offsets.hpp current for the patch.
 *   4. Run the map (npm run dev / START_MAP_FAST.bat), then run this provider.
 */

static const wchar_t* kProcessName = L"WarDogsClient-Win64-Shipping.exe"; // CHANGE ME if needed
static const char* kModuleName = "WarDogsClient-Win64-Shipping.exe";
static const char* kIngestUrl = "http://127.0.0.1:3000/api/ingest";

int main() {
  const char* env_url = std::getenv("WARDOGS_RADAR_URL");
  const char* url = env_url && *env_url ? env_url : kIngestUrl;

  std::printf("[byom] looking for %ls\n", kProcessName);
  DWORD pid = Win32RpmMemory::find_pid(kProcessName);
  if (!pid) {
    std::printf("[byom] process not found. edit kProcessName or implement your own attach.\n");
    return 1;
  }

  Win32RpmMemory mem(pid);
  if (!mem.ok()) {
    std::printf("[byom] OpenProcess failed (run elevated / check protections).\n");
    return 1;
  }

  u64 base = mem.module_base(kModuleName);
  if (!base) {
    std::printf("[byom] module base not found for %s\n", kModuleName);
    return 1;
  }
  std::printf("[byom] pid=%lu base=0x%llX -> %s\n", pid,
              static_cast<unsigned long long>(base), url);

  for (;;) {
    RadarSnapshot snap;
    if (sample_roster(mem, base, snap)) {
      if (!post_ingest(url, snap)) {
        std::printf("[byom] ingest POST failed (is the map running?)\n");
      } else {
        std::printf("[byom] posted %zu entities\n", snap.entities.size());
      }
    } else {
      std::printf("[byom] sample_roster failed (lobby / bad offsets / bad read)\n");
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(50)); // ~20 Hz
  }
}

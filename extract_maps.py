#!/usr/bin/env python3
"""
extract_maps.py  (shareable one-shot)

Pulls Wardogs tactical-map virtual textures + icons from your game Paks and
writes the tile pyramids this radar expects under public/maps + public/icons.

The release zip does NOT ship map tiles. Run this once after unzip so the
browser map has local JPEGs. AES key is embedded (override with --aes / WARDOGS_AES).

Needs:
  - Python 3.10+
  - .NET SDK (dotnet on PATH)  -- first run restores NuGet packages
  - Wardogs Content/Paks
  - a .usmap for your build (default: Desktop/507_Wardogs_release.usmap)

Usage:
  python extract_maps.py
  python extract_maps.py --paks "E:/SteamLibrary/steamapps/common/Wardogs/Wardogs/Content/Paks"
  python extract_maps.py --usmap "C:/path/to/507_Wardogs_release.usmap"
  python extract_maps.py --maps Kavkazi NorthAmerica --skip-icons

Env overrides: WARDOGS_PAKS, WARDOGS_USMAP, WARDOGS_AES
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

DEFAULT_AES = "0x9846DF67FCF3D8B35AFB12DDCBC2237EE51B2EFC40EF2D50A22F0D5EA8B5FD25"
DEFAULT_PAKS = r"E:\SteamLibrary\steamapps\common\Wardogs\Wardogs\Content\Paks"
DEFAULT_USMAP = str(Path.home() / "Desktop" / "507_Wardogs_release.usmap")

HERE = Path(__file__).resolve().parent
DEFAULT_OUT = HERE / "public"

# Embedded C# worker: mount IoStore, decode VTs / icons, write JPEG tile pyramids.
CSHARP = r'''
using System.Buffers;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using CUE4Parse.Encryption.Aes;
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Versions;
using CUE4Parse.Utils;
using CUE4Parse_Conversion.Textures;
using CUE4Parse_Conversion.Textures.BC;
using SkiaSharp;

var paks = args[0];
var usmap = args[1];
var aes = args[2];
var outRoot = args[3];
var mapsCsv = args[4];           // e.g. Kavkazi,NorthAmerica
var doIcons = args[5] == "1";

var mapsOut = Path.Combine(outRoot, "maps");
var iconsOut = Path.Combine(outRoot, "icons");
Directory.CreateDirectory(mapsOut);
Directory.CreateDirectory(iconsOut);

Console.Error.WriteLine($"Paks:  {paks}");
Console.Error.WriteLine($"Usmap: {usmap}");
Console.Error.WriteLine($"Out:   {outRoot}");

var provider = new DefaultFileProvider(
    new DirectoryInfo(paks), SearchOption.TopDirectoryOnly, true,
    new VersionContainer(EGame.GAME_UE5_LATEST));
provider.Initialize();
provider.SubmitKey(new FGuid(), new FAesKey(aes));
provider.MappingsContainer = new FileUsmapTypeMappingsProvider(usmap);
provider.PostMount();
Console.Error.WriteLine($"Mounted files: {provider.Files.Count}");

string? FindKey(string regex) =>
    provider.Files.Keys.FirstOrDefault(k =>
        Regex.IsMatch(k.Replace('\\', '/'), regex, RegexOptions.IgnoreCase));

static string Sanitize(string s)
{
    foreach (var c in Path.GetInvalidFileNameChars()) s = s.Replace(c, '_');
    return s;
}

static void SaveJpeg(SKBitmap bmp, string path, int quality)
{
    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    using var fs = File.Open(path, FileMode.Create, FileAccess.Write);
    using var data = bmp.Encode(SKEncodedImageFormat.Jpeg, quality);
    data.SaveTo(fs);
}

static void SavePng(SKBitmap bmp, string path)
{
    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    using var fs = File.Open(path, FileMode.Create, FileAccess.Write);
    using var data = bmp.Encode(SKEncodedImageFormat.Png, 100);
    data.SaveTo(fs);
}

// --- Icons (map UI) ---
if (doIcons)
{
    var iconInclude = new Regex(
        @"(?i)(/UI/Shared/Icons/(Trackers|Vehicles)/|/UI/Features/Map/Widgets/Trackers/Textures/|/UI/Features/PingWheel/.*/Textures/|/UI/Features/HUD/SpatialTrackers/.*/Textures/|/HotZoneMagnet/.*/Textures/|/UI/Features/Map/Map_Optimisation/Textures/|T_UI_(Player|FOB|Friendly|Havoc|Kodiak|Supply|Vision|Repair|Map_))",
        RegexOptions.Compiled);
    var iconExclude = new Regex(@"(?i)(Heightmap|LightMap|ShadowMap|Niagara|Landscape)", RegexOptions.Compiled);
    var iconKeys = provider.Files.Keys
        .Select(k => k.Replace('\\', '/'))
        .Where(k => iconInclude.IsMatch(k) && !iconExclude.IsMatch(k) && k.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToList();
    Console.Error.WriteLine($"Icon packages: {iconKeys.Count}");
    var iconOk = 0;
    foreach (var path in iconKeys)
    {
        try
        {
            var pkg = provider.LoadPackage(path);
            if (pkg == null) continue;
            foreach (var exp in pkg.GetExports())
            {
                if (exp is not UTexture2D tex2d) continue;
                var outFile = Path.Combine(iconsOut, Sanitize(exp.Name) + ".png");
                if (File.Exists(outFile) && new FileInfo(outFile).Length > 64) continue;
                var ctex = tex2d.Decode(ETexturePlatform.DesktopMobile);
                if (ctex == null) continue;
                using var sk = ctex.ToSkBitmap();
                SavePng(sk, outFile);
                iconOk++;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"ICON FAIL {path}: {ex.Message}");
        }
    }
    Console.Error.WriteLine($"Icons written: {iconOk}");
}

// Folder name on disk for each map id
string FolderFor(string id) => id.ToLowerInvariant() switch
{
    "northamerica" => "northamerica",
    "kavkazi" => "kavkazi",
    "europe" => "europe",
    "russia" => "russia",
    _ => id.ToLowerInvariant()
};

void TileFromBitmap(SKBitmap src, string folder, string? overviewName)
{
    const int TileSize = 512;
    if (src.Width != src.Height)
        throw new Exception($"expected square map, got {src.Width}x{src.Height}");

    var tileRoot = Path.Combine(mapsOut, folder);
    if (Directory.Exists(tileRoot)) Directory.Delete(tileRoot, true);
    Directory.CreateDirectory(tileRoot);

    var full = src.Width;
    var maxZ = 0;
    while ((TileSize << maxZ) < full) maxZ++;
    Console.Error.WriteLine($"  tiling {folder} native={full} z0..{maxZ}");

    for (var z = 0; z <= maxZ; z++)
    {
        var dim = TileSize << z;
        var n = 1 << z;
        using var level = new SKBitmap(dim, dim, SKColorType.Bgra8888, SKAlphaType.Opaque);
        using (var g = new SKCanvas(level))
        {
            g.Clear(SKColors.Black);
            g.DrawBitmap(src, new SKRect(0, 0, dim, dim));
        }
        for (var y = 0; y < n; y++)
        {
            var ydir = Path.Combine(tileRoot, z.ToString(), y.ToString());
            Directory.CreateDirectory(ydir);
            for (var x = 0; x < n; x++)
            {
                using var tile = new SKBitmap(TileSize, TileSize, SKColorType.Bgra8888, SKAlphaType.Opaque);
                using (var g = new SKCanvas(tile))
                {
                    g.DrawBitmap(level,
                        new SKRect(x * TileSize, y * TileSize, (x + 1) * TileSize, (y + 1) * TileSize),
                        new SKRect(0, 0, TileSize, TileSize));
                }
                SaveJpeg(tile, Path.Combine(ydir, $"{x}.jpg"), 90);
            }
        }
        Console.Error.WriteLine($"    z={z} {n}x{n}");
    }

    if (!string.IsNullOrEmpty(overviewName))
    {
        // 4096 overview
        const int overviewSize = 4096;
        using var overview = new SKBitmap(overviewSize, overviewSize, SKColorType.Bgra8888, SKAlphaType.Opaque);
        using (var g = new SKCanvas(overview))
        {
            g.Clear(SKColors.Black);
            g.DrawBitmap(src, new SKRect(0, 0, overviewSize, overviewSize));
        }
        SaveJpeg(overview, Path.Combine(mapsOut, overviewName), 85);
        Console.Error.WriteLine($"  overview {overviewName}");
    }
}

void ExportLargeVt(UTexture2D tex, string folder, int plane, string? overviewName)
{
    // Native 32k VT cannot Decode() into one bitmap — tile from mip0 chunks (NaExport path).
    var vt = tex.PlatformData?.VTData ?? throw new Exception("no VTData");
    Console.Error.WriteLine($"  VT {vt.Width}x{vt.Height} tile={vt.TileSize} border={vt.TileBorderSize}");

    const int level = 0;
    const int webTile = 512;
    var tileSize = (int)vt.TileSize;
    var tileBorder = (int)vt.TileBorderSize;
    var phys = (int)vt.GetPhysicalTileSize();
    var tod = vt.GetTileOffsetData(level);

    if (!PixelFormatUtils.PixelFormats.TryGetValue(vt.LayerTypes[0], out var formatInfo) || !formatInfo.Supported)
        throw new Exception($"unsupported layer format {vt.LayerTypes[0]}");

    var tileWBlocks = (phys + formatInfo.BlockSizeX - 1) / formatInfo.BlockSizeX;
    var tileHBlocks = (phys + formatInfo.BlockSizeY - 1) / formatInfo.BlockSizeY;
    var packedStride = tileWBlocks * formatInfo.BlockBytes;
    var packedOutputSize = packedStride * tileHBlocks;

    var tileByXY = new Dictionary<(int x, int y), uint>();
    for (uint i = 0; i < tod.MaxAddress; i++)
    {
        if (!vt.IsValidAddress(level, i)) continue;
        var tx = (int)MathUtils.ReverseMortonCode2(i);
        var ty = (int)MathUtils.ReverseMortonCode2(i >> 1);
        tileByXY[(tx, ty)] = i;
    }
    Console.Error.WriteLine($"  valid VT tiles: {tileByXY.Count}");

    SKBitmap DecodeVtTile(int tx, int ty)
    {
        if (!tileByXY.TryGetValue((tx, ty), out var tileIndex))
            return new SKBitmap(tileSize, tileSize, SKColorType.Bgra8888, SKAlphaType.Opaque);

        var layerData = ArrayPool<byte>.Shared.Rent(packedOutputSize);
        try
        {
            var (chunkIndex, tileStart, tileLength) = vt.GetTileData(level, tileIndex, 0);
            var bulk = vt.Chunks[chunkIndex].BulkData.Data
                       ?? throw new Exception($"null bulk chunk {chunkIndex}");
            Array.Copy(bulk, (int)tileStart, layerData, 0, packedOutputSize);
            var rgba = BCDecoder.BC1(layerData, phys, phys, 1);
            using var physBmp = new SKBitmap(phys, phys, SKColorType.Rgba8888, SKAlphaType.Opaque);
            Marshal.Copy(rgba, 0, physBmp.GetPixels(), rgba.Length);
            var cropped = new SKBitmap(tileSize, tileSize, SKColorType.Bgra8888, SKAlphaType.Opaque);
            using var c = new SKCanvas(cropped);
            c.Clear(SKColors.Black);
            c.DrawBitmap(physBmp,
                new SKRect(tileBorder, tileBorder, tileBorder + tileSize, tileBorder + tileSize),
                new SKRect(0, 0, tileSize, tileSize));
            return cropped;
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(layerData);
        }
    }

    var outDir = Path.Combine(mapsOut, folder);
    if (Directory.Exists(outDir)) Directory.Delete(outDir, true);
    Directory.CreateDirectory(outDir);

    var maxZ = 0;
    while ((webTile << maxZ) < plane) maxZ++;
    var zTop = maxZ;
    var nTop = 1 << zTop;
    Console.Error.WriteLine($"  building z={zTop} ({nTop}x{nTop}) from mip0...");

    var vtCache = new Dictionary<(int, int), SKBitmap>();
    SKBitmap GetCached(int tx, int ty)
    {
        if (vtCache.TryGetValue((tx, ty), out var b)) return b;
        var decoded = DecodeVtTile(tx, ty);
        vtCache[(tx, ty)] = decoded;
        return decoded;
    }

    for (var wy = 0; wy < nTop; wy++)
    {
        var ydir = Path.Combine(outDir, zTop.ToString(), wy.ToString());
        Directory.CreateDirectory(ydir);
        var y0 = wy * webTile;
        var y1 = y0 + webTile;
        var vtY0 = y0 / tileSize;
        var vtY1 = (y1 - 1) / tileSize;
        foreach (var key in vtCache.Keys.Where(k => k.Item2 < vtY0).ToList())
        {
            vtCache[key].Dispose();
            vtCache.Remove(key);
        }
        for (var wx = 0; wx < nTop; wx++)
        {
            var x0 = wx * webTile;
            var vtX0 = x0 / tileSize;
            var vtX1 = (x0 + webTile - 1) / tileSize;
            using var tileBmp = new SKBitmap(webTile, webTile, SKColorType.Bgra8888, SKAlphaType.Opaque);
            using (var c = new SKCanvas(tileBmp))
            {
                c.Clear(SKColors.Black);
                for (var vy = vtY0; vy <= vtY1; vy++)
                for (var vx = vtX0; vx <= vtX1; vx++)
                {
                    var src = GetCached(vx, vy);
                    c.DrawBitmap(src, vx * tileSize - x0, vy * tileSize - y0);
                }
            }
            SaveJpeg(tileBmp, Path.Combine(ydir, $"{wx}.jpg"), 90);
        }
        if ((wy + 1) % 8 == 0 || wy + 1 == nTop)
            Console.Error.WriteLine($"    row {wy + 1}/{nTop}");
    }
    foreach (var b in vtCache.Values) b.Dispose();
    vtCache.Clear();

    for (var z = zTop - 1; z >= 0; z--)
    {
        var n = 1 << z;
        Console.Error.WriteLine($"  z={z} grid={n}x{n}");
        for (var y = 0; y < n; y++)
        {
            var ydir = Path.Combine(outDir, z.ToString(), y.ToString());
            Directory.CreateDirectory(ydir);
            for (var x = 0; x < n; x++)
            {
                using var outBmp = new SKBitmap(webTile, webTile, SKColorType.Bgra8888, SKAlphaType.Opaque);
                using var canvas = new SKCanvas(outBmp);
                canvas.Clear(SKColors.Black);
                for (var oy = 0; oy < 2; oy++)
                for (var ox = 0; ox < 2; ox++)
                {
                    var childPath = Path.Combine(outDir, (z + 1).ToString(), (y * 2 + oy).ToString(), $"{x * 2 + ox}.jpg");
                    using var child = SKBitmap.Decode(childPath);
                    if (child == null) continue;
                    canvas.DrawBitmap(child,
                        new SKRect(0, 0, webTile, webTile),
                        new SKRect(ox * (webTile / 2f), oy * (webTile / 2f),
                                   (ox + 1) * (webTile / 2f), (oy + 1) * (webTile / 2f)),
                        new SKPaint { FilterQuality = SKFilterQuality.Medium });
                }
                SaveJpeg(outBmp, Path.Combine(ydir, $"{x}.jpg"), 88);
            }
        }
    }

    if (!string.IsNullOrEmpty(overviewName))
    {
        const int overviewSize = 4096;
        var overviewZ = 0;
        while ((webTile << overviewZ) < overviewSize) overviewZ++;
        var on = 1 << overviewZ;
        using var overview = new SKBitmap(overviewSize, overviewSize, SKColorType.Bgra8888, SKAlphaType.Opaque);
        using (var oc = new SKCanvas(overview))
        {
            oc.Clear(SKColors.Black);
            var cell = overviewSize / on;
            for (var y = 0; y < on; y++)
            for (var x = 0; x < on; x++)
            {
                var p = Path.Combine(outDir, overviewZ.ToString(), y.ToString(), $"{x}.jpg");
                using var t = SKBitmap.Decode(p);
                if (t == null) continue;
                oc.DrawBitmap(t, new SKRect(x * cell, y * cell, (x + 1) * cell, (y + 1) * cell));
            }
        }
        SaveJpeg(overview, Path.Combine(mapsOut, overviewName), 85);
        Console.Error.WriteLine($"  overview {overviewName}");
    }
}

var wanted = mapsCsv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
foreach (var id in wanted)
{
    Console.Error.WriteLine($"=== {id} ===");
    var vtKey = FindKey($@"Textures/{id}/T_UI_{id}_VT\.uasset$");
    if (vtKey == null)
    {
        Console.Error.WriteLine($"  MISS T_UI_{id}_VT");
        continue;
    }
    try
    {
        var pkg = provider.LoadPackage(vtKey) ?? throw new Exception("package null");
        var tex = pkg.GetExports().OfType<UTexture2D>().FirstOrDefault()
                  ?? throw new Exception("no UTexture2D");
        var folder = FolderFor(id);
        var overview = id.Equals("NorthAmerica", StringComparison.OrdinalIgnoreCase)
            ? "northamerica_overview.jpg"
            : null;

        var sizeX = tex.PlatformData?.SizeX ?? 0;
        var vt = tex.PlatformData?.VTData;
        var plane = (int)(vt?.Width ?? (uint)sizeX);
        if (plane <= 0) plane = sizeX;

        Console.Error.WriteLine($"  package ok size~{plane}");

        if (plane > 16384)
        {
            ExportLargeVt(tex, folder, plane, overview);
        }
        else
        {
            var ctex = tex.Decode(ETexturePlatform.DesktopMobile)
                       ?? throw new Exception("Decode returned null");
            using var sk = ctex.ToSkBitmap();
            TileFromBitmap(sk, folder, overview);
        }
        Console.Error.WriteLine($"  DONE {id}");
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"  FAIL {id}: {ex.Message}");
    }
}

Console.Error.WriteLine("ALL DONE");
Console.WriteLine(outRoot);
'''

CSPROJ = """\
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
    <NoWarn>NU1903;CS0618</NoWarn>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="CUE4Parse" Version="1.2.2.202609" />
    <PackageReference Include="CUE4Parse-Conversion" Version="1.2.2.202609" />
    <PackageReference Include="SkiaSharp" Version="2.88.9" />
    <PackageReference Include="SkiaSharp.NativeAssets.Win32" Version="2.88.9" />
    <PackageReference Include="SkiaSharp.NativeAssets.Linux" Version="2.88.9" />
  </ItemGroup>
</Project>
"""


def main() -> int:
    ap = argparse.ArgumentParser(
        description="One-shot: dump Wardogs map VTs + icons into public/maps and public/icons")
    ap.add_argument("--paks", default=os.environ.get("WARDOGS_PAKS", DEFAULT_PAKS),
                    help="path to Wardogs/Content/Paks")
    ap.add_argument("--usmap", default=os.environ.get("WARDOGS_USMAP", DEFAULT_USMAP),
                    help="path to .usmap for this build")
    ap.add_argument("--aes", default=os.environ.get("WARDOGS_AES", DEFAULT_AES),
                    help="IoStore AES key (0x...)")
    ap.add_argument("--out", default=str(DEFAULT_OUT),
                    help="output root (default: <this repo>/public)")
    ap.add_argument("--maps", nargs="+", default=["Kavkazi", "NorthAmerica"],
                    help="map ids under WorldCapture/Textures (e.g. Kavkazi NorthAmerica)")
    ap.add_argument("--skip-icons", action="store_true", help="maps only, skip icon dump")
    ap.add_argument("--keep-build", action="store_true",
                    help="leave the temp C# project around for debugging")
    args = ap.parse_args()

    paks, usmap, out = Path(args.paks), Path(args.usmap), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    if not paks.is_dir():
        print(f"ERROR: paks not found: {paks}", file=sys.stderr)
        print("Pass --paks to your Wardogs\\Content\\Paks folder", file=sys.stderr)
        return 1
    if not usmap.is_file():
        print(f"ERROR: usmap not found: {usmap}", file=sys.stderr)
        print("Pass --usmap to a .usmap matching your game build", file=sys.stderr)
        return 1
    if not shutil.which("dotnet"):
        print("ERROR: install .NET SDK 8+ and put dotnet on PATH", file=sys.stderr)
        return 1

    maps_csv = ",".join(args.maps)
    do_icons = "0" if args.skip_icons else "1"

    work = Path(tempfile.mkdtemp(prefix="wardogs_maps_"))
    try:
        (work / "ExtractMaps.csproj").write_text(CSPROJ, encoding="utf-8")
        (work / "Program.cs").write_text(CSHARP.lstrip("\n"), encoding="utf-8")

        print("Building CUE4Parse worker (first run pulls NuGet pkgs, can take a bit)...")
        r = subprocess.run(
            [
                "dotnet", "run", "-c", "Release",
                "--project", str(work / "ExtractMaps.csproj"),
                "--",
                str(paks), str(usmap), args.aes, str(out), maps_csv, do_icons,
            ],
            cwd=work,
        )
        if r.returncode != 0:
            return r.returncode

        print()
        print("=== Done ===")
        print(f"Maps:  {out / 'maps'}")
        print(f"Icons: {out / 'icons'}")
        print("Then: npm install && npm run dev  (or START_MAP_FAST.bat)")
        return 0
    finally:
        if args.keep_build:
            print(f"Build kept: {work}")
        else:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())

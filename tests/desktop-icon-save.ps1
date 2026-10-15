param(
  # Part 2 touches the real Desktop and is opt-in only.
  [switch]$DesktopFixture,
  [string]$DesktopName = "lightedit-icon-fixture-$(Get-Random).txt"
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class LightEditFileIdentity {
    // Field types and order must match the Win32 BY_HANDLE_FILE_INFORMATION
    // exactly; FILETIMEs are read as two DWORDs so no 8-byte alignment padding
    // is inserted by the marshaller.
    [StructLayout(LayoutKind.Sequential)]
    public struct FILETIME { public uint Low; public uint High; }
    [StructLayout(LayoutKind.Sequential)]
    public struct BY_HANDLE_FILE_INFORMATION {
        public uint FileAttributes;
        public FILETIME CreationTime;
        public FILETIME LastAccessTime;
        public FILETIME LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool GetFileInformationByHandle(IntPtr hFile, out BY_HANDLE_FILE_INFORMATION lpFileInformation);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool ReplaceFileW(string replaced, string replacement, string backup, uint flags, IntPtr exclude, IntPtr reserved);
    static ulong Combine(uint high, uint low) { return ((ulong)high << 32) | low; }
    /// "fileIndex|creationTime" in the same shape the Rust tests assert.
    public static string Describe(string path) {
        using (var stream = System.IO.File.Open(path, System.IO.FileMode.Open, System.IO.FileAccess.Read, System.IO.FileShare.ReadWrite)) {
            BY_HANDLE_FILE_INFORMATION info;
            if (!GetFileInformationByHandle(stream.SafeFileHandle.DangerousGetHandle(), out info)) { throw new System.ComponentModel.Win32Exception(); }
            return Combine(info.FileIndexHigh, info.FileIndexLow) + "|" + Combine(info.CreationTime.High, info.CreationTime.Low);
        }
    }
}
"@
function Get-Identity([string]$Path) { [LightEditFileIdentity]::Describe($Path) }

$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output = Join-Path $project ("test-results/desktop-icon/" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
New-Item -ItemType Directory -Path $output -Force | Out-Null
$report = [ordered]@{ output=$output; legacyReplace=$null; inPlace=$null; desktop=$null; failure=$null }
try {
  # ---- Part 1: isolated comparison of the two strategies -------------------
  $work = Join-Path $output 'strategy'
  New-Item -ItemType Directory -Path $work | Out-Null
  $target = Join-Path $work '照片 笔记.txt'
  [IO.File]::WriteAllText($target, "初始内容`r`n")
  $before = Get-Identity $target
  # Old strategy: sibling temp file + ReplaceFileW with a sibling backup dir.
  $temp = Join-Path $work 'replacement.tmp'
  $backup = Join-Path $work 'backup.tmp'
  [IO.File]::WriteAllText($temp, "替换后的内容`r`n")
  $ok = [LightEditFileIdentity]::ReplaceFileW($target, $temp, $backup, 0, [IntPtr]::Zero, [IntPtr]::Zero)
  if (-not $ok) { throw 'ReplaceFileW failed while measuring the legacy strategy.' }
  $afterReplace = Get-Identity $target
  $report.legacyReplace = [ordered]@{ identityBefore=$before; identityAfter=$afterReplace; identityPreserved=($before -eq $afterReplace) }
  Remove-Item -LiteralPath $backup -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $temp -ErrorAction SilentlyContinue
  # New strategy: in-place overwrite, no sibling entries.
  $stream = [IO.File]::Open($target, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::Read)
  $payload = [Text.Encoding]::UTF8.GetBytes("原位写回的内容，更长一些`r`n")
  $stream.Position = 0; $stream.Write($payload, 0, $payload.Length); $stream.SetLength($payload.Length)
  $stream.Flush($true); $stream.Close()
  $afterInPlace = Get-Identity $target
  $report.inPlace = [ordered]@{ identityBefore=$afterReplace; identityAfter=$afterInPlace; identityPreserved=($afterReplace -eq $afterInPlace); entries=(Get-ChildItem -LiteralPath $work).Count }
  if (-not $report.inPlace.identityPreserved) { throw 'In-place write did not preserve the file identity.' }
  if ($report.inPlace.entries -ne 1) { throw 'In-place write left sibling entries behind.' }

  # ---- Part 2: real Desktop fixture, opt-in only ---------------------------
  if ($DesktopFixture) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $fixture = Join-Path $desktop $DesktopName
    if (Test-Path -LiteralPath $fixture) { throw "Refusing to reuse an existing Desktop file: $fixture" }
    # Desktop icon positions are cached per shell item; record the raw cache so a
    # human can confirm the entry survives the save.
    $bags = 'HKCU:\Software\Microsoft\Windows\Shell\Bags'
    $beforeBags = @(Get-ChildItem $bags -Recurse -ErrorAction SilentlyContinue | Measure-Object).Count
    [IO.File]::WriteAllText($fixture, "桌面图标测试`r`n")
    $desktopBefore = Get-Identity $fixture
    $stream = [IO.File]::Open($fixture, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    $payload = [Text.Encoding]::UTF8.GetBytes("桌面图标测试（已保存，内容更长）`r`n")
    $stream.Position = 0; $stream.Write($payload, 0, $payload.Length); $stream.SetLength($payload.Length)
    $stream.Flush($true); $stream.Close()
    $desktopAfter = Get-Identity $fixture
    $afterBags = @(Get-ChildItem $bags -Recurse -ErrorAction SilentlyContinue | Measure-Object).Count
    $report.desktop = [ordered]@{ fixture=$fixture; identityBefore=$desktopBefore; identityAfter=$desktopAfter; identityPreserved=($desktopBefore -eq $desktopAfter); shellBagsBefore=$beforeBags; shellBagsAfter=$afterBags; content=[IO.File]::ReadAllText($fixture) }
    # Remove only the exact fixture this script created.
    Remove-Item -LiteralPath $fixture
    if (Test-Path -LiteralPath $fixture) { throw 'Desktop fixture cleanup failed.' }
  }
} catch { $report.failure = $_.Exception.Message }
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $output 'desktop-icon-results.json') -Encoding UTF8
Write-Output "Evidence: $output"
Write-Output ("Legacy ReplaceFileW preserved identity: " + $report.legacyReplace.identityPreserved)
Write-Output ("In-place write preserved identity: " + $report.inPlace.identityPreserved)
if ($DesktopFixture) { Write-Output ("Desktop fixture identity preserved: " + $report.desktop.identityPreserved) }
if ($report.failure) { Write-Output $report.failure; exit 1 }

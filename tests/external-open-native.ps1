param(
  # Isolated release binary built with app.appDirectoriesOverride (see the docs).
  [string]$Executable,
  [int]$ReadySeconds = 40
)
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$Executable) { $Executable = Join-Path $project 'src-tauri/target/release/markumo.exe' }
$Executable = (Resolve-Path -LiteralPath $Executable).Path
# The test binary carries its own bundle identifier, so another LightEdit window
# (a user's installed copy) neither receives these launches nor may be touched.
# Only refuse to start when a leftover instance of THIS executable is running.
$stale = @(Get-Process markumo -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Executable })
if ($stale.Count) { throw "A previous isolated test instance is still running: $($stale.Id -join ', ')" }
function Get-TestProcesses { return @(Get-Process markumo -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Executable }) }

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class LightEditWindows {
    delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr hWnd, StringBuilder text, int count);
    /// "class|title" for every visible top-level window of one process. The app
    /// window class is "Tauri Window"; the single-instance plugin and Tao also
    /// own top-level helper windows that must not be counted as editor windows.
    public static string[] TopLevelFor(uint processId) {
        var rows = new List<string>();
        EnumWindows((hWnd, _) => {
            uint pid; GetWindowThreadProcessId(hWnd, out pid);
            if (pid == processId && IsWindowVisible(hWnd)) {
                var title = new StringBuilder(512);
                GetWindowTextW(hWnd, title, title.Capacity);
                var cls = new StringBuilder(512);
                GetClassNameW(hWnd, cls, cls.Capacity);
                rows.Add(cls.ToString() + "|" + title.ToString());
            }
            return true;
        }, IntPtr.Zero);
        return rows.ToArray();
    }
}
"@

$output = Join-Path $project ('test-results/external-open/' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
$profile = Join-Path $output 'profile'
$fixtures = Join-Path $output 'fixtures'
New-Item -ItemType Directory -Path $profile, $fixtures -Force | Out-Null
# Chinese and spaces in the file names are part of the test.
$alpha = Join-Path $fixtures ([char]0x6D4B + [char]0x8BD5 + ' Alpha.txt')
$beta = Join-Path $fixtures ([char]0x8D1D + [char]0x5854 + ' Beta.md')
Set-Content -LiteralPath $alpha -Value 'alpha content' -Encoding UTF8
Set-Content -LiteralPath $beta -Value '# beta' -Encoding UTF8
$report = [ordered]@{
  executable = $Executable; output = $output
  startedPids = @(); windowCounts = @(); secondInstanceExit = $null; processCount = $null
  sessionFileCreated = $false; sessionTabPaths = @(); failure = $null
}
$appProcess = $null
$started = New-Object System.Collections.Generic.List[int]

function Start-App([string[]]$Arguments) {
  $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $profile 'webview'
  $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -PassThru -WindowStyle Hidden
  $started.Add($process.Id)
  return $process
}
function Get-AppWindows([int]$ProcessId) {
  # Only the editor window class counts; IPC and Tao helper windows do not.
  return @([LightEditWindows]::TopLevelFor([uint32]$ProcessId) | Where-Object { $_ -like 'Tauri Window|*' })
}
function Wait-VisibleWindows([int]$ProcessId, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $titles = Get-AppWindows $ProcessId
    if ($titles.Count -ge 1) { return $titles }
    Start-Sleep -Milliseconds 250
  }
  return @()
}
try {
  $first = Start-App @($alpha)
  $titles = Wait-VisibleWindows $first.Id $ReadySeconds
  if ($titles.Count -ne 1) { throw "A file launch must open exactly one window, saw $($titles.Count)." }
  $appProcess = $first
  $report.windowCounts += [ordered]@{ step = 'open Alpha.txt'; count = $titles.Count; titles = $titles }

  # Repeated double-click of the same file must not create another window.
  foreach ($round in 1..3) {
    $repeat = Start-App @($alpha)
    if (!$repeat.WaitForExit(30000)) { throw "Repeated launch $round was not forwarded to the running instance." }
    $report.secondInstanceExit = $repeat.ExitCode
  }
  Start-Sleep -Seconds 2
  $afterRepeat = Get-AppWindows $appProcess.Id
  $report.windowCounts += [ordered]@{ step = 'repeat Alpha.txt x3'; count = $afterRepeat.Count; titles = $afterRepeat }
  if ($afterRepeat.Count -ne 1) { throw "Repeated opens of one file created extra windows ($($afterRepeat.Count))." }

  # A different file must join the existing single-file window.
  $other = Start-App @($beta)
  if (!$other.WaitForExit(30000)) { throw 'The second file launch was not forwarded to the running instance.' }
  Start-Sleep -Seconds 2
  $afterOther = Get-AppWindows $appProcess.Id
  $report.windowCounts += [ordered]@{ step = 'open Beta.md'; count = $afterOther.Count; titles = $afterOther }
  if ($afterOther.Count -ne 1) { throw "Opening a different file created an extra window ($($afterOther.Count))." }

  # Rapid concurrent double-clicks must still resolve to a single window.
  $rapid = @()
  foreach ($i in 1..4) { $rapid += (Start-App @($alpha)) }
  foreach ($process in $rapid) { if (!$process.WaitForExit(30000)) { throw 'A concurrent launch was not forwarded to the running instance.' } }
  Start-Sleep -Seconds 2
  $afterRapid = Get-AppWindows $appProcess.Id
  $report.windowCounts += [ordered]@{ step = 'four concurrent Alpha.txt'; count = $afterRapid.Count; titles = $afterRapid }
  if ($afterRapid.Count -ne 1) { throw "Concurrent opens created extra windows ($($afterRapid.Count))." }

  # Only one process may exist: the single-instance plugin forwards the rest.
  $processes = Get-TestProcesses
  $report.processCount = $processes.Count
  if ($processes.Count -ne 1) { throw "Expected exactly one test LightEdit process, saw $($processes.Count)." }

  # A file-association launch is a temporary window and must not claim the main
  # session, so no last-session.json may be written for it.
  $sessionPath = Join-Path $profile 'com.lightedit.app/last-session.json'
  $report.sessionFileCreated = Test-Path -LiteralPath $sessionPath
  if ($report.sessionFileCreated) {
    $session = Get-Content -LiteralPath $sessionPath -Raw | ConvertFrom-Json
    $report.sessionTabPaths = @($session.tabs | ForEach-Object { $_.path })
    if ($report.sessionTabPaths -contains [IO.Path]::GetFullPath($alpha)) { throw 'The file launch polluted the main session.' }
  }
} catch { $report.failure = $_.Exception.Message }
finally {
  foreach ($id in $started) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  $report.startedPids = @($started)
  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $output 'external-open-results.json') -Encoding UTF8
}
Write-Output "Evidence: $output"
if ($report.failure) { Write-Output $report.failure; exit 1 }
Write-Output 'PASS: repeated and concurrent external opens reuse one window and one process; file launch leaves the main session untouched.'
Write-Output 'NOT RUN here: per-tab activation, workspace-window focus and Explorer double-click (need desktop UI automation).'

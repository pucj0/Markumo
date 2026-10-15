param([string]$ImagePath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
# Keep the original clipboard in memory and restore it when the fixture finishes.
$original = [System.Windows.Forms.Clipboard]::GetDataObject()
$backup = New-Object System.Windows.Forms.DataObject
if ($original) {
    foreach ($format in $original.GetFormats($false)) {
        $data = $original.GetData($format, $false)
        if ($data) { $backup.SetData($format, $false, $data) }
    }
}
try {
    [Console]::WriteLine('READY')
    while ($mode = [Console]::ReadLine()) {
        if ($mode -eq 'stop') { break }
        if ($mode -eq 'file') {
            $list = New-Object System.Collections.Specialized.StringCollection
            [void]$list.Add($ImagePath)
            [System.Windows.Forms.Clipboard]::SetFileDropList($list)
        } elseif ($mode -eq 'pixels') {
            $image = [System.Drawing.Image]::FromFile($ImagePath)
            try { [System.Windows.Forms.Clipboard]::SetImage($image) } finally { $image.Dispose() }
        } elseif ($mode -eq 'text') {
            [System.Windows.Forms.Clipboard]::SetText('clipboard plain text')
        } else { throw 'Unknown clipboard fixture command' }
        [Console]::WriteLine("OK:$mode")
    }
} finally {
    [System.Windows.Forms.Clipboard]::SetDataObject($backup, $true)
    [Console]::WriteLine('RESTORED')
}

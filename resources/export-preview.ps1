param([Parameter(Mandatory=$true)][string]$InputPath,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
$source=(Resolve-Path -LiteralPath $InputPath).Path
$target=[IO.Path]::GetFullPath($OutputPath)
if([IO.Path]::GetExtension($source).ToLowerInvariant() -notin @('.ppt','.pptx')) { throw 'Expected PPT or PPTX.' }
$existing=@(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue)
$app=$null;$deck=$null;$security=$null
try {
 $app=New-Object -ComObject PowerPoint.Application
 $security=$app.AutomationSecurity;$app.AutomationSecurity=3
 $deck=$app.Presentations.Open($source,-1,0,0)
 # One PDF page per slide, all slides including hidden ones, static view.
 $deck.ExportAsFixedFormat($target,2,1,0,1,1,-1,$null,1,'',$false,$true,$true,$true,$false)
} finally {
 if($deck) { $deck.Close();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($deck) }
 if($app) { if($null -ne $security) {$app.AutomationSecurity=$security};if($existing.Count -eq 0 -and $app.Presentations.Count -eq 0) {$app.Quit()};[void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
}

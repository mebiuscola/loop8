param(
 [Parameter(Mandatory=$true)][string]$InputPath,
 [Parameter(Mandatory=$true)][string]$OutputPath,
 # Optional: also export every slide (hidden ones included) as a PNG drawn by PowerPoint itself.
 [string]$SlidesDir='',
 [int]$Width=1920
)
$ErrorActionPreference='Stop'
# Errors reach Classroom as UTF-8 (a Chinese Windows would otherwise send them in its own code page).
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$source=(Resolve-Path -LiteralPath $InputPath).Path
$target=[IO.Path]::GetFullPath($OutputPath)
if([IO.Path]::GetExtension($source).ToLowerInvariant() -notin @('.ppt','.pptx')) { throw 'Expected PPT or PPTX.' }
$existing=@(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue)
$app=$null;$deck=$null;$security=$null
try {
 $app=New-Object -ComObject PowerPoint.Application
 # Macros off; the file is opened read-only, without a window, so the user's open decks are untouched.
 $security=$app.AutomationSecurity;$app.AutomationSecurity=3
 $deck=$app.Presentations.Open($source,-1,0,0)
 if($SlidesDir) {
  $dir=[IO.Path]::GetFullPath($SlidesDir)
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $w=[double]$deck.PageSetup.SlideWidth;$h=[double]$deck.PageSetup.SlideHeight
  $height=[int][Math]::Round($Width*$h/$w)
  $count=$deck.Slides.Count
  for($i=1;$i -le $count;$i++) { $deck.Slides.Item($i).Export((Join-Path $dir ("slide-$i.png")),'PNG',$Width,$height) }
  # Written last: its presence means every slide was exported.
  (@{count=$count;width=$Width;height=$height} | ConvertTo-Json -Compress) | Set-Content -LiteralPath (Join-Path $dir 'slides.json') -Encoding ASCII
 }
 # One PDF page per slide, hidden slides included (checked against the slide count by the caller).
 # ExportAsFixedFormat fails from PowerShell (its optional range argument cannot be passed), so Save As PDF.
 $deck.SaveAs($target,32)
} finally {
 if($deck) { $deck.Close();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($deck) }
 if($app) { if($null -ne $security) {$app.AutomationSecurity=$security};if($existing.Count -eq 0 -and $app.Presentations.Count -eq 0) {$app.Quit()};[void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
}

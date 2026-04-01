Stop-Process -Id 42724 -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Set-Location "D:\Dev\Tools\nanoclaw"
$proc = Start-Process -FilePath "node" -ArgumentList "dist/index.js" -NoNewWindow -PassThru
Write-Host "NanoClaw started (PID $($proc.Id))."

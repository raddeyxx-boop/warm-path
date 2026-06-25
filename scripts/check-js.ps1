$ErrorActionPreference = 'Stop'

$files = git ls-files '*.js' |
    Where-Object {
        $_ -notlike 'node_modules/*' -and
        $_ -notlike 'fresh-profile/*' -and
        $_ -notlike 'linkedin-profile/*'
    }

foreach ($file in $files) {
    node --check $file

    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

Write-Host "Checked $($files.Count) JavaScript file(s)."

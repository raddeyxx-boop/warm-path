$ErrorActionPreference = 'Stop'

$files = Get-ChildItem -Recurse -Filter '*.js' |
    ForEach-Object {
        Resolve-Path -Relative $_.FullName
    } |
    ForEach-Object {
        $_ -replace '^\.\\', ''
    } |
    Where-Object {
        $_ -notlike 'node_modules/*' -and
        $_ -notlike 'node_modules\*' -and
        $_ -notlike 'fresh-profile/*' -and
        $_ -notlike 'fresh-profile\*' -and
        $_ -notlike 'linkedin-profile/*' -and
        $_ -notlike 'linkedin-profile\*' -and
        $_ -notlike 'n8n_backup/*' -and
        $_ -notlike 'n8n_backup\*'
    }

foreach ($file in $files) {
    node --check $file

    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

Write-Host "Checked $($files.Count) JavaScript file(s)."

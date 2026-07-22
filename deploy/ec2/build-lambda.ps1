param(
    [string]$OutputPath = (Join-Path $PSScriptRoot "dist\ai-worker.zip")
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$backendRoot = Join-Path $repoRoot "backend"
$tempRoot = [System.IO.Path]::GetTempPath()
$buildRoot = Join-Path $tempRoot ("lsatspeedrun-lambda-" + [guid]::NewGuid().ToString("N"))
$packageRoot = Join-Path $buildRoot "package"
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)

try {
    New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
    python -m pip install `
        --requirement (Join-Path $backendRoot "requirements-lambda.txt") `
        --target $packageRoot `
        --platform manylinux2014_x86_64 `
        --implementation cp `
        --python-version 3.11 `
        --only-binary=:all: `
        --disable-pip-version-check `
        --no-compile `
        --retries 2 `
        --timeout 30 `
        --upgrade

    Copy-Item -Recurse -Path (Join-Path $backendRoot "app") -Destination $packageRoot
    Copy-Item -Path (Join-Path $backendRoot "lambda_handler.py") -Destination $packageRoot
    New-Item -ItemType Directory -Path (Split-Path $resolvedOutput) -Force | Out-Null
    if (Test-Path -LiteralPath $resolvedOutput) {
        Remove-Item -LiteralPath $resolvedOutput
    }
    Compress-Archive -Path (Join-Path $packageRoot "*") -DestinationPath $resolvedOutput -CompressionLevel Optimal
    Write-Host "Built Lambda artifact: $resolvedOutput"
}
finally {
    $resolvedBuild = [System.IO.Path]::GetFullPath($buildRoot)
    if ($resolvedBuild.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path $resolvedBuild -Leaf).StartsWith("lsatspeedrun-lambda-")) {
        Remove-Item -LiteralPath $resolvedBuild -Recurse -Force -ErrorAction SilentlyContinue
    }
}

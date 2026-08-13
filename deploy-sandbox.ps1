[CmdletBinding()]
param(
    [string]$CommitMessage = "Deploy AWS sandbox",
    [string]$GitUserName = "",
    [string]$GitUserEmail = "",
    [string]$StackName = "lsatspeedrun-sandbox",
    [string]$AwsProfile = "sbsandbox",
    [string]$ExpectedAwsAccount = "056956104102",
    [string]$Region = "us-east-1",
    [string]$Remote = "origin",
    [ValidateRange(5, 59)]
    [int]$PollSeconds = 10,
    [ValidateRange(5, 45)]
    [int]$BootstrapTimeoutMinutes = 28
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Resolve-Executable {
    param([string[]]$Names)
    foreach ($name in $Names) {
        $command = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command) {
            return $command.Source
        }
    }
    throw "Required command was not found: $($Names -join ', ')"
}

function Invoke-External {
    param(
        [string]$FilePath,
        [string[]]$ArgumentList = @()
    )
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($ArgumentList -join ' ')"
    }
}

function Get-ExternalOutput {
    param(
        [string]$FilePath,
        [string[]]$ArgumentList = @()
    )
    $output = @(& $FilePath @ArgumentList)
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($ArgumentList -join ' ')"
    }
    return ($output -join [Environment]::NewLine).Trim()
}

function Get-GitConfigValue {
    param(
        [string]$GitPath,
        [string]$Key
    )
    $value = @(& $GitPath config --get $Key)
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 1) {
        return ""
    }
    if ($exitCode -ne 0) {
        throw "Could not read git configuration key $Key."
    }
    return ($value -join [Environment]::NewLine).Trim()
}

function Assert-StagedContentSafe {
    param([string]$GitPath)
    $stagedPaths = @(& $GitPath diff --cached --name-only)
    if ($LASTEXITCODE -ne 0) {
        throw "Could not inspect staged files."
    }
    $blocked = @(
        $stagedPaths | Where-Object {
            (
                $_ -match '(?i)(^|/)\.env(?:\.|$)' -and
                $_ -notmatch '(?i)(^|/)\.env(?:\.[^/]+)*\.(example|sample)$'
            ) -or
            $_ -match '(?i)(^|/)(credentials?(?:\.|$)|secrets?(?:\.|$))' -or
            $_ -match '(?i)\.(pem|key|p12|pfx)$'
        }
    )
    if ($blocked.Count -gt 0) {
        throw "Refusing to commit possible secret files: $($blocked -join ', ')"
    }
    Invoke-External -FilePath $GitPath -ArgumentList @("diff", "--cached", "--check")
}

function Get-AwsJson {
    param([string[]]$ArgumentList)
    $raw = Get-ExternalOutput -FilePath $script:AwsExecutable -ArgumentList ($ArgumentList + @("--output", "json"))
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return $null
    }
    return $raw | ConvertFrom-Json
}

function Set-SandboxCredentials {
    param(
        [string]$CredentialHelper,
        [string]$Profile,
        [string]$DeployRegion,
        [string]$ExpectedAccount,
        [int]$MinimumLifetimeMinutes
    )
    $credentialRaw = Get-ExternalOutput -FilePath $CredentialHelper -ArgumentList @(
        "credential_process", "--profile", $Profile
    )
    $credentials = $credentialRaw | ConvertFrom-Json
    foreach ($property in @("AccessKeyId", "SecretAccessKey", "SessionToken")) {
        if ([string]::IsNullOrWhiteSpace([string]$credentials.$property)) {
            throw "The AWS credential helper did not return $property."
        }
    }
    $expirationProperty = $credentials.PSObject.Properties["Expiration"]
    if ($expirationProperty) {
        if ($expirationProperty.Value -is [DateTime]) {
            $credentialExpiration = [DateTimeOffset]$expirationProperty.Value
        }
        else {
            $credentialExpiration = [DateTimeOffset]::Parse(
                [string]$expirationProperty.Value,
                [Globalization.CultureInfo]::InvariantCulture,
                [Globalization.DateTimeStyles]::AssumeUniversal
            )
        }
        if ($credentialExpiration -lt [DateTimeOffset]::UtcNow.AddMinutes($MinimumLifetimeMinutes)) {
            throw "The sandbox AWS credentials expire too soon to deploy safely."
        }
    }
    $env:AWS_ACCESS_KEY_ID = [string]$credentials.AccessKeyId
    $env:AWS_SECRET_ACCESS_KEY = [string]$credentials.SecretAccessKey
    $env:AWS_SESSION_TOKEN = [string]$credentials.SessionToken
    $env:AWS_DEFAULT_REGION = $DeployRegion
    $env:AWS_REGION = $DeployRegion
    $env:AWS_PAGER = ""
    $env:PYTHONIOENCODING = "utf-8"
    $identity = Get-AwsJson -ArgumentList @("sts", "get-caller-identity")
    if ($ExpectedAccount -and [string]$identity.Account -ne $ExpectedAccount) {
        throw "Refusing to deploy to AWS account $($identity.Account); expected $ExpectedAccount."
    }
    return $identity
}

function Clear-SandboxCredentials {
    foreach ($name in @("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN")) {
        [Environment]::SetEnvironmentVariable($name, $null, "Process")
    }
}

function Get-StackParameterValue {
    param(
        [object]$Stack,
        [string]$Key
    )
    $match = @($Stack.Parameters | Where-Object { $_.ParameterKey -eq $Key })
    if ($match.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$match[0].ParameterValue)) {
        throw "Stack parameter $Key is missing."
    }
    return [string]$match[0].ParameterValue
}

function Get-StackOutputValue {
    param(
        [object]$Stack,
        [string]$Key
    )
    $match = @($Stack.Outputs | Where-Object { $_.OutputKey -eq $Key })
    if ($match.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$match[0].OutputValue)) {
        throw "Stack output $Key is missing."
    }
    return [string]$match[0].OutputValue
}

function Wait-ForSsmOnline {
    param(
        [string]$InstanceId,
        [datetime]$Deadline
    )
    while ((Get-Date) -lt $Deadline) {
        $response = Get-AwsJson -ArgumentList @(
            "ssm", "describe-instance-information",
            "--filters", "Key=InstanceIds,Values=$InstanceId"
        )
        $instances = @($response.InstanceInformationList)
        if ($instances.Count -eq 1 -and $instances[0].PingStatus -eq "Online") {
            return
        }
        Start-Sleep -Seconds $PollSeconds
    }
    throw "EC2 instance $InstanceId did not become available in Systems Manager."
}

function Invoke-SsmCommandAndWait {
    param(
        [string]$InstanceId,
        [string]$Comment,
        [string[]]$Commands,
        [int]$TimeoutSeconds
    )
    $parameters = @{ commands = @($Commands) } | ConvertTo-Json -Compress
    $parametersPath = Join-Path ([IO.Path]::GetTempPath()) ("lsat-tycoon-ssm-" + [guid]::NewGuid().ToString("N") + ".json")
    try {
        [IO.File]::WriteAllText($parametersPath, $parameters, (New-Object Text.UTF8Encoding $false))
        $sent = Get-AwsJson -ArgumentList @(
            "ssm", "send-command",
            "--instance-ids", $InstanceId,
            "--document-name", "AWS-RunShellScript",
            "--comment", $Comment,
            "--timeout-seconds", $TimeoutSeconds.ToString(),
            "--parameters", "file://$parametersPath"
        )
    }
    finally {
        if (Test-Path -LiteralPath $parametersPath) {
            Remove-Item -LiteralPath $parametersPath -Force
        }
    }
    $commandId = [string]$sent.Command.CommandId
    if ([string]::IsNullOrWhiteSpace($commandId)) {
        throw "Systems Manager did not return a command ID."
    }

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds + 30)
    Start-Sleep -Seconds 2
    while ((Get-Date) -lt $deadline) {
        try {
            $invocation = Get-AwsJson -ArgumentList @(
                "ssm", "get-command-invocation",
                "--command-id", $commandId,
                "--instance-id", $InstanceId
            )
        }
        catch {
            Start-Sleep -Seconds $PollSeconds
            continue
        }
        $status = [string]$invocation.Status
        if ($status -eq "Success") {
            return $invocation
        }
        if ($status -in @("Cancelled", "Cancelling", "Failed", "TimedOut")) {
            Write-Host ([string]$invocation.StandardOutputContent)
            Write-Host ([string]$invocation.StandardErrorContent) -ForegroundColor Red
            throw "Systems Manager command '$Comment' ended with status $status."
        }
        Start-Sleep -Seconds $PollSeconds
    }
    throw "Systems Manager command '$Comment' timed out."
}

function Wait-ForHealth {
    param(
        [string]$BaseUrl,
        [datetime]$Deadline
    )
    $healthUrl = "$($BaseUrl.TrimEnd('/'))/v1/health"
    $lastError = "No response"
    while ((Get-Date) -lt $Deadline) {
        try {
            $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 30
            if ($health.status -eq "ok") {
                return $health
            }
            $lastError = "status was '$($health.status)'"
        }
        catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Seconds $PollSeconds
    }
    throw "Health check failed for $healthUrl. Last error: $lastError"
}

function Wait-ForEventSourceState {
    param(
        [string]$Uuid,
        [string]$DesiredState,
        [datetime]$Deadline
    )
    while ((Get-Date) -lt $Deadline) {
        $mapping = Get-AwsJson -ArgumentList @(
            "lambda", "get-event-source-mapping", "--uuid", $Uuid
        )
        if ([string]$mapping.State -eq $DesiredState) {
            return
        }
        if ([string]$mapping.State -eq "Deleting") {
            throw "The AI worker event source is being deleted."
        }
        Start-Sleep -Seconds $PollSeconds
    }
    throw "The AI worker event source did not reach state $DesiredState."
}

function Get-AiWorkerEventSourceMapping {
    param(
        [string]$FunctionName,
        [string]$QueueUrl
    )
    $queueAttributes = Get-AwsJson -ArgumentList @(
        "sqs", "get-queue-attributes",
        "--queue-url", $QueueUrl,
        "--attribute-names", "QueueArn"
    )
    $queueArn = [string]$queueAttributes.Attributes.QueueArn
    if ([string]::IsNullOrWhiteSpace($queueArn)) {
        throw "Could not resolve the AI queue ARN."
    }
    $mappingResponse = Get-AwsJson -ArgumentList @(
        "lambda", "list-event-source-mappings", "--function-name", $FunctionName
    )
    $matchingMappings = @(
        $mappingResponse.EventSourceMappings | Where-Object { $_.EventSourceArn -eq $queueArn }
    )
    if ($matchingMappings.Count -ne 1) {
        throw "Expected exactly one SQS event source for Lambda $FunctionName."
    }
    return $matchingMappings[0]
}

function Disable-EventSourceMapping {
    param(
        [string]$Uuid,
        [datetime]$Deadline
    )
    while ((Get-Date) -lt $Deadline) {
        $mapping = Get-AwsJson -ArgumentList @(
            "lambda", "get-event-source-mapping", "--uuid", $Uuid
        )
        $state = [string]$mapping.State
        if ($state -eq "Disabled") {
            return
        }
        if ($state -eq "Enabled") {
            [void](Get-AwsJson -ArgumentList @(
                "lambda", "update-event-source-mapping",
                "--uuid", $Uuid,
                "--no-enabled"
            ))
        }
        elseif ($state -notin @("Creating", "Enabling", "Disabling", "Updating")) {
            throw "Cannot safely disable AI delivery while the event source is in state $state."
        }
        Start-Sleep -Seconds $PollSeconds
    }
    throw "The AI worker event source did not become disabled."
}

function Disable-SandboxAiWorker {
    param(
        [string]$DeployStackName,
        [datetime]$Deadline
    )
    $lastError = "mapping unavailable"
    while ((Get-Date) -lt $Deadline) {
        try {
            $stackResponse = Get-AwsJson -ArgumentList @(
                "cloudformation", "describe-stacks", "--stack-name", $DeployStackName
            )
            $currentStack = @($stackResponse.Stacks)[0]
            if (-not $currentStack) {
                throw "CloudFormation stack $DeployStackName was not found while pausing AI delivery."
            }
            $functionName = Get-StackOutputValue -Stack $currentStack -Key "AiWorkerFunction"
            $queueUrl = Get-StackOutputValue -Stack $currentStack -Key "AiJobQueueUrl"
            $mapping = Get-AiWorkerEventSourceMapping -FunctionName $functionName -QueueUrl $queueUrl
            Disable-EventSourceMapping -Uuid ([string]$mapping.UUID) -Deadline ((Get-Date).AddMinutes(5))
            return
        }
        catch {
            $lastError = $_.Exception.Message
            Start-Sleep -Seconds $PollSeconds
        }
    }
    throw "Could not pause AI delivery before the recovery deadline. Last error: $lastError"
}

function Wait-ForQueueQuiescence {
    param(
        [string]$QueueUrl,
        [bool]$RequireEmpty,
        [datetime]$Deadline
    )
    $lastCounts = "unavailable"
    while ((Get-Date) -lt $Deadline) {
        $attributes = Get-AwsJson -ArgumentList @(
            "sqs", "get-queue-attributes",
            "--queue-url", $QueueUrl,
            "--attribute-names",
            "ApproximateNumberOfMessages",
            "ApproximateNumberOfMessagesNotVisible",
            "ApproximateNumberOfMessagesDelayed"
        )
        $visible = [int]$attributes.Attributes.ApproximateNumberOfMessages
        $inFlight = [int]$attributes.Attributes.ApproximateNumberOfMessagesNotVisible
        $delayed = [int]$attributes.Attributes.ApproximateNumberOfMessagesDelayed
        $lastCounts = "visible=$visible, in-flight=$inFlight, delayed=$delayed"
        if ($inFlight -eq 0 -and (-not $RequireEmpty -or ($visible -eq 0 -and $delayed -eq 0))) {
            return
        }
        Start-Sleep -Seconds $PollSeconds
    }
    throw "The AI queue did not become quiescent ($lastCounts)."
}

function Convert-HexToBase64 {
    param([string]$Hex)
    if ($Hex.Length % 2 -ne 0 -or $Hex -notmatch '^[0-9a-fA-F]+$') {
        throw "Invalid hexadecimal digest."
    }
    $bytes = New-Object byte[] ($Hex.Length / 2)
    for ($index = 0; $index -lt $bytes.Length; $index++) {
        $bytes[$index] = [Convert]::ToByte($Hex.Substring($index * 2, 2), 16)
    }
    return [Convert]::ToBase64String($bytes)
}

$repoRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$originalLocation = Get-Location
$environmentNames = @(
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_DEFAULT_REGION",
    "AWS_REGION",
    "AWS_PAGER",
    "PYTHONIOENCODING"
)
$previousEnvironment = @{}
$workerPaused = $false
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

try {
    Set-Location $repoRoot
    $gitExecutable = Resolve-Executable -Names @("git.exe", "git")
    $npmExecutable = Resolve-Executable -Names @("npm.cmd", "npm")
    $script:AwsExecutable = Resolve-Executable -Names @("aws.exe", "aws")
    $credentialHelper = Resolve-Executable -Names @("sb-aws-creds.cmd", "sb-aws-creds")

    Write-Step "Preflighting the AWS sandbox"
    $credentialParameters = @{
        CredentialHelper = $credentialHelper
        Profile = $AwsProfile
        DeployRegion = $Region
        ExpectedAccount = $ExpectedAwsAccount
        MinimumLifetimeMinutes = 20
    }
    $identity = Set-SandboxCredentials @credentialParameters
    Write-Host "AWS account $($identity.Account), region $Region"

    $stackResponse = Get-AwsJson -ArgumentList @(
        "cloudformation", "describe-stacks", "--stack-name", $StackName
    )
    $stack = @($stackResponse.Stacks)[0]
    if (-not $stack) {
        throw "CloudFormation stack $StackName was not found."
    }
    $deployableStackStatuses = @("CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE")
    if ($stack.StackStatus -notin $deployableStackStatuses) {
        throw "CloudFormation stack $StackName is not ready: $($stack.StackStatus)."
    }
    $stackId = [string]$stack.StackId
    foreach ($requiredTag in @("Project", "Owner", "ManagedBy", "Environment")) {
        $tagMatch = @($stack.Tags | Where-Object { $_.Key -eq $requiredTag })
        if ($tagMatch.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$tagMatch[0].Value)) {
            throw "CloudFormation stack $StackName is missing required tag $requiredTag."
        }
    }
    $expectedBoundary = "arn:aws:iam::${ExpectedAwsAccount}:policy/InternSandboxBoundary"
    $configuredBoundary = Get-StackParameterValue -Stack $stack -Key "PermissionsBoundaryArn"
    if ($ExpectedAwsAccount -and $configuredBoundary -ne $expectedBoundary) {
        throw "The stack permissions boundary does not match the sandbox account."
    }
    $manifest = Get-Content -LiteralPath (Join-Path $repoRoot "backend\data\question_bank\manifest.json") -Raw |
        ConvertFrom-Json
    $expectedQuestionCount = [int]$manifest.total_questions
    if ($expectedQuestionCount -lt 1) {
        throw "The question-bank manifest has no questions."
    }
    $stackRepository = Get-StackParameterValue -Stack $stack -Key "GitRepository"
    [void](Get-AwsJson -ArgumentList @(
        "cloudformation", "validate-template",
        "--template-body", "file://deploy/ec2/cloudformation.yaml"
    ))
    Clear-SandboxCredentials

    Write-Step "Synchronizing main"
    $branch = Get-ExternalOutput -FilePath $gitExecutable -ArgumentList @("branch", "--show-current")
    if ($branch -ne "main") {
        throw "Run this command from the main branch. Current branch: $branch"
    }
    $remoteUrl = Get-ExternalOutput -FilePath $gitExecutable -ArgumentList @("remote", "get-url", $Remote)
    $normalizedRemoteUrl = ($remoteUrl.TrimEnd('/') -replace '(?i)\.git$', '').ToLowerInvariant()
    $normalizedStackRepository = ($stackRepository.TrimEnd('/') -replace '(?i)\.git$', '').ToLowerInvariant()
    if ($normalizedRemoteUrl -ne $normalizedStackRepository) {
        throw "Git remote $Remote does not match the repository configured in CloudFormation."
    }
    $gitDirectory = Get-ExternalOutput -FilePath $gitExecutable -ArgumentList @("rev-parse", "--absolute-git-dir")
    $operationPaths = @(
        (Join-Path $gitDirectory "MERGE_HEAD"),
        (Join-Path $gitDirectory "CHERRY_PICK_HEAD"),
        (Join-Path $gitDirectory "REVERT_HEAD"),
        (Join-Path $gitDirectory "rebase-merge"),
        (Join-Path $gitDirectory "rebase-apply")
    )
    if (@($operationPaths | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0) {
        throw "Finish the current merge, rebase, cherry-pick, or revert before deploying."
    }
    Invoke-External -FilePath $gitExecutable -ArgumentList @("fetch", $Remote, "main")
    $localCommit = Get-ExternalOutput -FilePath $gitExecutable -ArgumentList @("rev-parse", "HEAD")
    $remoteCommit = Get-ExternalOutput -FilePath $gitExecutable -ArgumentList @("rev-parse", "$Remote/main")
    if ($localCommit -ne $remoteCommit) {
        & $gitExecutable merge-base --is-ancestor $localCommit $remoteCommit
        $localIsBehind = $LASTEXITCODE
        if ($localIsBehind -eq 0) {
            $preMergeChanges = Get-ExternalOutput -FilePath $gitExecutable -ArgumentList @("status", "--porcelain")
            if (-not [string]::IsNullOrWhiteSpace($preMergeChanges)) {
                throw "Local main is behind $Remote/main and has uncommitted changes. Synchronize it first."
            }
            Invoke-External -FilePath $gitExecutable -ArgumentList @("merge", "--ff-only", "$Remote/main")
        }
        elseif ($localIsBehind -eq 1) {
            & $gitExecutable merge-base --is-ancestor $remoteCommit $localCommit
            $remoteIsBehind = $LASTEXITCODE
            if ($remoteIsBehind -ne 0) {
                throw "Local main and $Remote/main have diverged. Reconcile them before deploying."
            }
        }
        else {
            throw "Could not compare local main with $Remote/main."
        }
    }

    Write-Step "Staging and validating the release"
    Invoke-External -FilePath $gitExecutable -ArgumentList @("add", "--all")
    Assert-StagedContentSafe -GitPath $gitExecutable
    Invoke-External -FilePath $gitExecutable -ArgumentList @("diff", "--cached", "--stat")
    & $gitExecutable diff --cached --quiet
    $initialStagedStatus = $LASTEXITCODE
    if ($initialStagedStatus -ne 0 -and $initialStagedStatus -ne 1) {
        throw "Could not determine whether the release has staged changes."
    }
    $hasStagedChanges = $initialStagedStatus -eq 1
    $resolvedGitName = $GitUserName
    $resolvedGitEmail = $GitUserEmail
    if ($hasStagedChanges) {
        if ([string]::IsNullOrWhiteSpace($resolvedGitName)) {
            $resolvedGitName = Get-GitConfigValue -GitPath $gitExecutable -Key "user.name"
        }
        if ([string]::IsNullOrWhiteSpace($resolvedGitEmail)) {
            $resolvedGitEmail = Get-GitConfigValue -GitPath $gitExecutable -Key "user.email"
        }
        if ([string]::IsNullOrWhiteSpace($resolvedGitName)) {
            $resolvedGitName = "AWS Sandbox Deploy"
            Write-Warning "git user.name is not configured; using '$resolvedGitName'."
        }
        if ([string]::IsNullOrWhiteSpace($resolvedGitEmail)) {
            $resolvedGitEmail = "sandbox-deploy@local.invalid"
            Write-Warning "git user.email is not configured; using '$resolvedGitEmail'."
        }
    }

    $venvPython = if ($IsWindows) {
        Join-Path $repoRoot ".venv\Scripts\python.exe"
    }
    else {
        Join-Path $repoRoot ".venv/bin/python"
    }
    if (-not (Test-Path -LiteralPath $venvPython)) {
        $bootstrapPython = Resolve-Executable -Names @("python.exe", "python")
        Invoke-External -FilePath $bootstrapPython -ArgumentList @("-m", "venv", (Join-Path $repoRoot ".venv"))
    }
    Invoke-External -FilePath $venvPython -ArgumentList @(
        "-m", "pip", "install",
        "--disable-pip-version-check",
        "--requirement", (Join-Path $repoRoot "backend\requirements.txt")
    )
    Invoke-External -FilePath $venvPython -ArgumentList @("-m", "pytest", "-q")

    Push-Location (Join-Path $repoRoot "frontend")
    try {
        Invoke-External -FilePath $npmExecutable -ArgumentList @("ci")
        Invoke-External -FilePath $npmExecutable -ArgumentList @("run", "build")
    }
    finally {
        Pop-Location
    }

    Write-Step "Building the pitch deck"
    Push-Location (Join-Path $repoRoot "deck")
    try {
        $env:DECK_BASE = "/pitch/"
        Invoke-External -FilePath $npmExecutable -ArgumentList @("ci")
        Invoke-External -FilePath $npmExecutable -ArgumentList @("run", "build")
        $deckIndex = Get-Content -LiteralPath (Join-Path (Get-Location) "dist/index.html") -Raw
        if ($deckIndex -notmatch '/pitch/assets/') {
            throw "The deck production build did not emit assets under /pitch/."
        }
    }
    finally {
        Remove-Item Env:DECK_BASE -ErrorAction SilentlyContinue
        Pop-Location
    }

    Write-Step "Building the Lambda worker"
    $artifactPath = Join-Path $repoRoot "deploy\ec2\dist\ai-worker.zip"
    & (Join-Path $repoRoot "deploy\ec2\build-lambda.ps1") -OutputPath $artifactPath -PythonPath $venvPython
    if (-not (Test-Path -LiteralPath $artifactPath)) {
        throw "The Lambda build did not create $artifactPath."
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($artifactPath)
    try {
        $entryNames = @($archive.Entries | ForEach-Object { $_.FullName })
        $uncompressedBytes = ($archive.Entries | Measure-Object -Property Length -Sum).Sum
        if ([int64]$uncompressedBytes -ge 250MB) {
            throw "The Lambda artifact exceeds Lambda's 250 MB uncompressed limit."
        }
        if (@($entryNames | Where-Object { $_ -match '(^|/)__pycache__/|\.(pyc|pyo)$' }).Count -gt 0) {
            throw "The Lambda artifact contains Python bytecode cache files."
        }
        foreach ($requiredEntry in @("lambda_handler.py", "app/__init__.py", "app/game.py")) {
            if ($requiredEntry -notin $entryNames) {
                throw "The Lambda artifact is missing $requiredEntry."
            }
        }
        $handlerEntry = $archive.GetEntry("lambda_handler.py")
        $handlerReader = New-Object IO.StreamReader($handlerEntry.Open())
        try {
            $handlerSource = $handlerReader.ReadToEnd()
        }
        finally {
            $handlerReader.Dispose()
        }
        if (-not $handlerSource.Contains("instance_path") -or -not $handlerSource.Contains("/tmp")) {
            throw "The Lambda handler is not configured for Lambda's writable /tmp directory."
        }
    }
    finally {
        $archive.Dispose()
    }

    & $gitExecutable diff --quiet
    if ($LASTEXITCODE -eq 1) {
        throw "A tracked file changed while validation was running. Review it and re-run the deploy."
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Could not verify the working tree after validation."
    }
    $newUntrackedFiles = Get-ExternalOutput -FilePath $gitExecutable -ArgumentList @(
        "ls-files", "--others", "--exclude-standard"
    )
    if (-not [string]::IsNullOrWhiteSpace($newUntrackedFiles)) {
        throw "New untracked files appeared during validation. Review them before deploying.`n$newUntrackedFiles"
    }
    Assert-StagedContentSafe -GitPath $gitExecutable
    if ($hasStagedChanges) {
        Invoke-External -FilePath $gitExecutable -ArgumentList @(
            "-c", "user.name=$resolvedGitName",
            "-c", "user.email=$resolvedGitEmail",
            "commit", "-m", $CommitMessage
        )
    }

    $remainingChanges = Get-ExternalOutput -FilePath $gitExecutable -ArgumentList @("status", "--porcelain")
    if (-not [string]::IsNullOrWhiteSpace($remainingChanges)) {
        throw "The working tree changed during validation. Review it before deploying.`n$remainingChanges"
    }
    $commitSha = Get-ExternalOutput -FilePath $gitExecutable -ArgumentList @("rev-parse", "HEAD")
    if ($commitSha -notmatch '^[0-9a-f]{40}$') {
        throw "Git did not return a full commit SHA."
    }

    Write-Step "Pushing $commitSha to main"
    Invoke-External -FilePath $gitExecutable -ArgumentList @("fetch", $Remote, "main")
    & $gitExecutable merge-base --is-ancestor "$Remote/main" $commitSha
    if ($LASTEXITCODE -ne 0) {
        throw "$Remote/main advanced during validation. Re-run after synchronizing main."
    }
    Invoke-External -FilePath $gitExecutable -ArgumentList @("push", $Remote, "HEAD:main")
    $remoteLine = Get-ExternalOutput -FilePath $gitExecutable -ArgumentList @("ls-remote", $Remote, "refs/heads/main")
    $publishedCommit = ($remoteLine -split '\s+')[0]
    if ($publishedCommit -ne $commitSha) {
        throw "Remote main does not point at the release commit."
    }

    Write-Step "Refreshing sandbox AWS credentials"
    $credentialParameters.MinimumLifetimeMinutes = 45
    $identity = Set-SandboxCredentials @credentialParameters
    Write-Host "AWS account $($identity.Account), region $Region"

    $stackResponse = Get-AwsJson -ArgumentList @(
        "cloudformation", "describe-stacks", "--stack-name", $StackName
    )
    $stack = @($stackResponse.Stacks)[0]
    if (-not $stack -or [string]$stack.StackId -ne $stackId) {
        throw "CloudFormation stack $StackName changed identity during release validation."
    }
    if ($stack.StackStatus -notin $deployableStackStatuses) {
        throw "CloudFormation stack $StackName is no longer ready: $($stack.StackStatus)."
    }
    $configuredBoundary = Get-StackParameterValue -Stack $stack -Key "PermissionsBoundaryArn"
    if ($ExpectedAwsAccount -and $configuredBoundary -ne $expectedBoundary) {
        throw "The stack permissions boundary changed during release validation."
    }
    $refreshedRepository = Get-StackParameterValue -Stack $stack -Key "GitRepository"
    $normalizedRefreshedRepository = ($refreshedRepository.TrimEnd('/') -replace '(?i)\.git$', '').ToLowerInvariant()
    if ($normalizedRefreshedRepository -ne $normalizedRemoteUrl) {
        throw "The stack Git repository changed during release validation."
    }

    $artifactBucket = Get-StackParameterValue -Stack $stack -Key "LambdaCodeS3Bucket"
    $bucketLocation = Get-AwsJson -ArgumentList @(
        "s3api", "get-bucket-location", "--bucket", $artifactBucket
    )
    $bucketRegion = [string]$bucketLocation.LocationConstraint
    if ([string]::IsNullOrWhiteSpace($bucketRegion)) {
        $bucketRegion = "us-east-1"
    }
    if ($bucketRegion -ne $Region) {
        throw "Artifact bucket $artifactBucket is in $bucketRegion, not $Region."
    }
    $artifactHash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $artifactKey = "lambda/$commitSha/$artifactHash/ai-worker.zip"

    Write-Step "Uploading Lambda artifact"
    Invoke-External -FilePath $script:AwsExecutable -ArgumentList @(
        "s3", "cp", $artifactPath, "s3://$artifactBucket/$artifactKey",
        "--only-show-errors",
        "--metadata", "git-commit=$commitSha,sha256=$artifactHash"
    )
    $uploaded = Get-AwsJson -ArgumentList @(
        "s3api", "head-object", "--bucket", $artifactBucket, "--key", $artifactKey
    )
    $artifactLength = (Get-Item -LiteralPath $artifactPath).Length
    if ([int64]$uploaded.ContentLength -ne $artifactLength) {
        throw "The uploaded Lambda artifact size does not match the local build."
    }
    $uploadedHashProperty = $uploaded.Metadata.PSObject.Properties["sha256"]
    if (-not $uploadedHashProperty -or [string]$uploadedHashProperty.Value -ne $artifactHash) {
        throw "The uploaded Lambda artifact hash metadata does not match the local build."
    }
    if ([string]::IsNullOrWhiteSpace([string]$uploaded.ServerSideEncryption)) {
        throw "The uploaded Lambda artifact is not server-side encrypted."
    }

    Write-Step "Revalidating CloudFormation and pausing AI deliveries"
    [void](Get-AwsJson -ArgumentList @(
        "cloudformation", "validate-template",
        "--template-body", "file://deploy/ec2/cloudformation.yaml"
    ))
    $existingLambdaFunction = Get-StackOutputValue -Stack $stack -Key "AiWorkerFunction"
    $existingQueueUrl = Get-StackOutputValue -Stack $stack -Key "AiJobQueueUrl"
    $existingMapping = Get-AiWorkerEventSourceMapping `
        -FunctionName $existingLambdaFunction `
        -QueueUrl $existingQueueUrl
    $eventSourceUuid = [string]$existingMapping.UUID
    $workerPaused = $true
    Disable-EventSourceMapping -Uuid $eventSourceUuid -Deadline ((Get-Date).AddMinutes(5))
    Wait-ForQueueQuiescence `
        -QueueUrl $existingQueueUrl `
        -RequireEmpty $false `
        -Deadline ((Get-Date).AddMinutes(5))

    Write-Step "Updating CloudFormation with AI deliveries paused"
    $deployArguments = @(
        "cloudformation", "deploy",
        "--template-file", (Join-Path $repoRoot "deploy\ec2\cloudformation.yaml"),
        "--stack-name", $StackName,
        "--capabilities", "CAPABILITY_IAM",
        "--parameter-overrides",
        "GitCommit=$commitSha",
        "LambdaCodeS3Bucket=$artifactBucket",
        "LambdaCodeS3Key=$artifactKey",
        "AiWorkerEnabled=false",
        "--no-fail-on-empty-changeset"
    )
    $stackTags = @($stack.Tags)
    if ($stackTags.Count -gt 0) {
        $deployArguments += "--tags"
        foreach ($tag in $stackTags) {
            $deployArguments += "$($tag.Key)=$($tag.Value)"
        }
    }
    Invoke-External -FilePath $script:AwsExecutable -ArgumentList $deployArguments

    $updatedStackResponse = Get-AwsJson -ArgumentList @(
        "cloudformation", "describe-stacks", "--stack-name", $StackName
    )
    $updatedStack = @($updatedStackResponse.Stacks)[0]
    if ($updatedStack.StackStatus -ne "UPDATE_COMPLETE" -and $updatedStack.StackStatus -ne "CREATE_COMPLETE") {
        throw "CloudFormation ended in state $($updatedStack.StackStatus)."
    }
    $instanceId = Get-StackOutputValue -Stack $updatedStack -Key "InstanceId"
    $applicationUrl = Get-StackOutputValue -Stack $updatedStack -Key "ApplicationUrl"
    $directInstanceUrl = Get-StackOutputValue -Stack $updatedStack -Key "DirectInstanceUrl"
    $lambdaFunction = Get-StackOutputValue -Stack $updatedStack -Key "AiWorkerFunction"
    $queueUrl = Get-StackOutputValue -Stack $updatedStack -Key "AiJobQueueUrl"
    $dlqUrl = Get-StackOutputValue -Stack $updatedStack -Key "AiJobDeadLetterQueueUrl"
    if ((Get-StackParameterValue -Stack $updatedStack -Key "AiWorkerEnabled") -ne "false") {
        throw "CloudFormation did not preserve the paused AI worker state."
    }
    $updatedMapping = Get-AiWorkerEventSourceMapping `
        -FunctionName $lambdaFunction `
        -QueueUrl $queueUrl
    $eventSourceUuid = [string]$updatedMapping.UUID
    Disable-EventSourceMapping -Uuid $eventSourceUuid -Deadline ((Get-Date).AddMinutes(5))

    Write-Step "Waiting for EC2 bootstrap and migrations"
    $bootstrapDeadline = (Get-Date).AddMinutes($BootstrapTimeoutMinutes)
    Wait-ForSsmOnline -InstanceId $instanceId -Deadline $bootstrapDeadline
    $commitCheck = 'test "$(git -C /opt/lsat-speedrun rev-parse HEAD)" = "' + $commitSha + '"'
    $bootstrapCommandParameters = @{
        InstanceId = $instanceId
        Comment = "Verify LSAT Tycoon bootstrap"
        TimeoutSeconds = $BootstrapTimeoutMinutes * 60
        Commands = @(
            "set -euo pipefail",
            "cloud-init status --wait",
            $commitCheck,
            "systemctl is-active --quiet lsat-speedrun",
            "systemctl is-active --quiet nginx",
            "curl --fail --silent --show-error http://127.0.0.1/v1/health >/dev/null"
        )
    }
    [void](Invoke-SsmCommandAndWait @bootstrapCommandParameters)
    $healthDeadline = (Get-Date).AddMinutes(5)
    $directHealth = Wait-ForHealth -BaseUrl $directInstanceUrl -Deadline $healthDeadline
    $publicHealth = Wait-ForHealth -BaseUrl $applicationUrl -Deadline $healthDeadline
    if (
        -not $directHealth.async_jobs.ready -or
        -not $publicHealth.async_jobs.ready -or
        $publicHealth.async_jobs.mode -ne "sqs" -or
        -not $publicHealth.coaching.ready -or
        $publicHealth.coaching.model -ne "gpt-5.6-luna" -or
        $publicHealth.coaching.reasoning_effort -ne "xhigh" -or
        [int]$publicHealth.questions.total -ne $expectedQuestionCount
    ) {
        throw "The deployed API is not fully configured."
    }
    $indexResponse = Invoke-WebRequest -Uri $applicationUrl -UseBasicParsing -TimeoutSec 30
    if ($indexResponse.StatusCode -ne 200 -or $indexResponse.Content -notmatch '<title>Lawyer Tycoon</title>') {
        throw "CloudFront is not serving the Lawyer Tycoon frontend."
    }
    if ($indexResponse.Content -notmatch 'createDemoCursor|deckDemo|autoplay') {
        $assetMatches = [regex]::Matches($indexResponse.Content, '/assets/[^"]+\.js')
        $foundDemoHook = $false
        foreach ($assetMatch in $assetMatches) {
            try {
                $asset = Invoke-WebRequest -Uri "$($applicationUrl.TrimEnd('/'))$($assetMatch.Value)" -UseBasicParsing -TimeoutSec 30
                if ($asset.Content -match 'createDemoCursor|deckDemo') {
                    $foundDemoHook = $true
                    break
                }
            }
            catch {
                continue
            }
        }
        if (-not $foundDemoHook) {
            throw "The deployed frontend is missing live-demo hooks (deckDemo/createDemoCursor)."
        }
    }
    $pitchResponse = Invoke-WebRequest -Uri "$($applicationUrl.TrimEnd('/'))/pitch/" -UseBasicParsing -TimeoutSec 30
    if (
        $pitchResponse.StatusCode -ne 200 -or
        $pitchResponse.Content -notmatch '/pitch/assets/' -or
        $pitchResponse.Content -notmatch 'Company presentation'
    ) {
        throw "CloudFront is not serving the pitch deck at /pitch/."
    }
    $authConfig = Invoke-RestMethod -Uri "$($applicationUrl.TrimEnd('/'))/v1/auth/config" -TimeoutSec 30
    if (-not $authConfig.google_client_id -or $authConfig.dev_auth_enabled) {
        throw "Production authentication is not configured safely."
    }

    $credentialParameters.MinimumLifetimeMinutes = 15
    $identity = Set-SandboxCredentials @credentialParameters
    Write-Step "Verifying Lambda cold start"
    $lambdaConfiguration = Get-AwsJson -ArgumentList @(
        "lambda", "get-function-configuration", "--function-name", $lambdaFunction
    )
    $expectedLambdaCodeHash = Convert-HexToBase64 -Hex $artifactHash
    if (
        $lambdaConfiguration.State -ne "Active" -or
        $lambdaConfiguration.LastUpdateStatus -ne "Successful" -or
        $lambdaConfiguration.CodeSha256 -ne $expectedLambdaCodeHash
    ) {
        throw "Lambda is not active with the artifact built by this deployment."
    }
    $lambdaResponsePath = Join-Path ([IO.Path]::GetTempPath()) ("lsat-tycoon-lambda-" + [guid]::NewGuid().ToString("N") + ".json")
    $lambdaRequestPath = Join-Path ([IO.Path]::GetTempPath()) ("lsat-tycoon-lambda-request-" + [guid]::NewGuid().ToString("N") + ".json")
    $lambdaProbePayload = '{"Records":[{"messageId":"deployment-cold-start","body":"{\"job_id\":\"00000000-0000-0000-0000-000000000000\"}"}]}'
    try {
        [IO.File]::WriteAllText($lambdaRequestPath, $lambdaProbePayload, (New-Object Text.UTF8Encoding $false))
        $lambdaInvoke = Get-AwsJson -ArgumentList @(
            "lambda", "invoke",
            "--function-name", $lambdaFunction,
            "--payload", "fileb://$lambdaRequestPath",
            $lambdaResponsePath
        )
        $functionErrorProperty = $lambdaInvoke.PSObject.Properties["FunctionError"]
        if (
            [int]$lambdaInvoke.StatusCode -ne 200 -or
            ($functionErrorProperty -and $functionErrorProperty.Value)
        ) {
            throw "The Lambda cold-start check failed."
        }
        $lambdaPayload = Get-Content -LiteralPath $lambdaResponsePath -Raw | ConvertFrom-Json
        if (@($lambdaPayload.batchItemFailures).Count -ne 0) {
            throw "The Lambda handler rejected its database connectivity probe."
        }
    }
    finally {
        if (Test-Path -LiteralPath $lambdaResponsePath) {
            Remove-Item -LiteralPath $lambdaResponsePath -Force
        }
        if (Test-Path -LiteralPath $lambdaRequestPath) {
            Remove-Item -LiteralPath $lambdaRequestPath -Force
        }
    }

    if ($lambdaFunction -notmatch '^[A-Za-z0-9-_]{1,64}$') {
        throw "CloudFormation returned an invalid Lambda function name."
    }
    Write-Step "Running Lambda -> TrueFoundry canary with SQS paused"
    $directSmokeCommandParameters = @{
        InstanceId = $instanceId
        Comment = "Verify direct Lambda TrueFoundry coaching"
        TimeoutSeconds = 420
        Commands = @(
            "set -euo pipefail; set -a; . /etc/lsat-speedrun.env; set +a; cd /opt/lsat-speedrun/backend; runuser -u lsatapp -- /opt/lsat-speedrun/.venv/bin/python -m scripts.smoke_async_coaching --timeout-seconds 300 --lambda-function $lambdaFunction"
        )
    }
    $directSmokeInvocation = Invoke-SsmCommandAndWait @directSmokeCommandParameters
    $directSmokeLines = @(
        ([string]$directSmokeInvocation.StandardOutputContent -split "`r?`n") |
            Where-Object { $_.Trim().StartsWith("{") }
    )
    if ($directSmokeLines.Count -lt 1) {
        throw "The direct Lambda TrueFoundry canary did not return a JSON result."
    }
    $directSmokeResult = $directSmokeLines[-1] | ConvertFrom-Json
    if (
        $directSmokeResult.status -ne "ok" -or
        $directSmokeResult.transport -ne "direct-lambda" -or
        $directSmokeResult.provider -ne "TrueFoundry" -or
        $directSmokeResult.model -ne "gpt-5.6-luna" -or
        $directSmokeResult.reasoning_effort -ne "xhigh" -or
        -not $directSmokeResult.exactly_once -or
        -not $directSmokeResult.cleanup
    ) {
        throw "The direct Lambda TrueFoundry canary returned an invalid result."
    }
    Wait-ForQueueQuiescence `
        -QueueUrl $queueUrl `
        -RequireEmpty $false `
        -Deadline ((Get-Date).AddMinutes(5))

    Write-Step "Enabling SQS deliveries after the migration"
    $credentialParameters.MinimumLifetimeMinutes = 15
    $identity = Set-SandboxCredentials @credentialParameters
    $enableWorkerArguments = @(
        $deployArguments | ForEach-Object {
            if ($_ -eq "AiWorkerEnabled=false") {
                "AiWorkerEnabled=true"
            }
            else {
                $_
            }
        }
    )
    Invoke-External -FilePath $script:AwsExecutable -ArgumentList $enableWorkerArguments
    $enabledStackResponse = Get-AwsJson -ArgumentList @(
        "cloudformation", "describe-stacks", "--stack-name", $StackName
    )
    $enabledStack = @($enabledStackResponse.Stacks)[0]
    if ((Get-StackParameterValue -Stack $enabledStack -Key "AiWorkerEnabled") -ne "true") {
        throw "CloudFormation did not enable the AI worker."
    }
    $lambdaFunction = Get-StackOutputValue -Stack $enabledStack -Key "AiWorkerFunction"
    $queueUrl = Get-StackOutputValue -Stack $enabledStack -Key "AiJobQueueUrl"
    $enabledMapping = Get-AiWorkerEventSourceMapping `
        -FunctionName $lambdaFunction `
        -QueueUrl $queueUrl
    $eventSourceUuid = [string]$enabledMapping.UUID
    $enableWaitParameters = @{
        Uuid = $eventSourceUuid
        DesiredState = "Enabled"
        Deadline = (Get-Date).AddMinutes(5)
    }
    Wait-ForEventSourceState @enableWaitParameters

    Write-Step "Running SQS -> Lambda -> TrueFoundry settlement smoke test"
    $smokeCommandParameters = @{
        InstanceId = $instanceId
        Comment = "Verify TrueFoundry coaching pipeline"
        TimeoutSeconds = 420
        Commands = @(
            "set -euo pipefail; set -a; . /etc/lsat-speedrun.env; set +a; cd /opt/lsat-speedrun/backend; runuser -u lsatapp -- /opt/lsat-speedrun/.venv/bin/python -m scripts.smoke_async_coaching --timeout-seconds 300"
        )
    }
    $smokeInvocation = Invoke-SsmCommandAndWait @smokeCommandParameters
    $smokeLines = @(
        ([string]$smokeInvocation.StandardOutputContent -split "`r?`n") |
            Where-Object { $_.Trim().StartsWith("{") }
    )
    if ($smokeLines.Count -lt 1) {
        throw "The TrueFoundry smoke test did not return a JSON result."
    }
    $smokeResult = $smokeLines[-1] | ConvertFrom-Json
    if (
        $smokeResult.status -ne "ok" -or
        $smokeResult.transport -ne "sqs" -or
        $smokeResult.provider -ne "TrueFoundry" -or
        $smokeResult.model -ne "gpt-5.6-luna" -or
        $smokeResult.reasoning_effort -ne "xhigh" -or
        -not $smokeResult.exactly_once -or
        -not $smokeResult.cleanup
    ) {
        throw "The TrueFoundry smoke test returned an invalid result."
    }

    $dlqAttributes = Get-AwsJson -ArgumentList @(
        "sqs", "get-queue-attributes",
        "--queue-url", $dlqUrl,
        "--attribute-names",
        "ApproximateNumberOfMessages",
        "ApproximateNumberOfMessagesNotVisible",
        "ApproximateNumberOfMessagesDelayed"
    )
    $deadLetterCount =
        [int]$dlqAttributes.Attributes.ApproximateNumberOfMessages +
        [int]$dlqAttributes.Attributes.ApproximateNumberOfMessagesNotVisible +
        [int]$dlqAttributes.Attributes.ApproximateNumberOfMessagesDelayed
    if ($deadLetterCount -ne 0) {
        throw "The AI dead-letter queue contains $deadLetterCount message(s)."
    }
    Wait-ForQueueQuiescence `
        -QueueUrl $queueUrl `
        -RequireEmpty $true `
        -Deadline ((Get-Date).AddMinutes(5))
    $workerPaused = $false

    Write-Step "Provisioning the Google demo account on RDS"
    $provisionParameters = @{
        InstanceId = $instanceId
        Comment = "Provision deployed Google demo account"
        TimeoutSeconds = 600
        Commands = @(
            "set -euo pipefail; set -a; . /etc/lsat-speedrun.env; set +a; export ALLOW_DEPLOYED_DEMO_SEED=1; cd /opt/lsat-speedrun/backend; /opt/lsat-speedrun/.venv/bin/python scripts/provision_deployed_demo.py --apply --email alanmakeel@gmail.com"
        )
    }
    $provisionInvocation = Invoke-SsmCommandAndWait @provisionParameters
    $provisionLines = @(
        ([string]$provisionInvocation.StandardOutputContent -split "`r?`n") |
            Where-Object { $_.Trim().StartsWith("{") }
    )
    if ($provisionLines.Count -lt 1) {
        throw "Demo account provisioning did not return a JSON result."
    }
    $provisionResult = $provisionLines[-1] | ConvertFrom-Json
    if (-not $provisionResult.sessions.liveSessionId -or -not $provisionResult.sessions.soloSessionId) {
        throw "Demo account provisioning did not write live session ids."
    }

    Write-Host "`nDeployment complete." -ForegroundColor Green
    Write-Host "Application: $applicationUrl"
    Write-Host "Pitch:      $($applicationUrl.TrimEnd('/'))/pitch/"
    Write-Host "Commit:     $commitSha"
    Write-Host "EC2:        $instanceId"
    Write-Host "Lambda:     $lambdaFunction"
    Write-Host "AI smoke:   $($smokeResult.model), score $($smokeResult.score), exactly-once payout verified"
    Write-Host "Demo user:  $($provisionResult.email) ($($provisionResult.merge.action))"
}
catch {
    $deploymentError = $_
    if ($workerPaused) {
        $pauseVerified = $false
        try {
            $credentialParameters.MinimumLifetimeMinutes = 30
            [void](Set-SandboxCredentials @credentialParameters)
        }
        catch {
            Write-Warning "Could not refresh AWS credentials before pausing AI delivery: $($_.Exception.Message)"
        }
        try {
            Disable-SandboxAiWorker `
                -DeployStackName $StackName `
                -Deadline ((Get-Date).AddMinutes(15))
            $pauseVerified = $true
        }
        catch {
            Write-Warning "Could not verify that AI SQS delivery is paused: $($_.Exception.Message)"
        }
        if ($pauseVerified) {
            Write-Warning "AI SQS delivery is paused to protect queued jobs. Fix the reported failure and re-run deploy-sandbox.ps1 to restore it safely."
        }
    }
    throw $deploymentError
}
finally {
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], "Process")
    }
    Set-Location $originalLocation
}

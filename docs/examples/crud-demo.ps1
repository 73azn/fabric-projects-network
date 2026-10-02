# Full walk-through of the API from Windows PowerShell (5.1 or 7): create, read, add payments, update, history,
# and the error cases. Nothing to install.
#   .\docs\examples\crud-demo.ps1 [-Base http://localhost:4000]
#   If the server requires an API key:  $env:API_KEY = '...'; .\docs\examples\crud-demo.ps1 -Base https://chain.example.com
# It creates ONE project named PRJ-DEMO-<time>.
param([string]$Base = 'http://localhost:4000')

$Id = 'PRJ-DEMO-' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

# Call <method> <path> [body-as-hashtable] [headers]  -> prints "HTTP <code>" and the JSON answer
function Call {
    param([string]$Method, [string]$Path, $Body = $null, [hashtable]$Headers = @{})
    if ($env:API_KEY) { $Headers = @{} + $Headers; $Headers['Authorization'] = "Bearer $($env:API_KEY)" }
    $params = @{ Method = $Method; Uri = "$Base$Path"; Headers = $Headers; UseBasicParsing = $true }
    if ($null -ne $Body) {
        $params.Body = ($Body | ConvertTo-Json -Depth 10)
        $params.ContentType = 'application/json'
    }
    try {
        $r = Invoke-WebRequest @params
        $code = [int]$r.StatusCode
        $text = $r.Content
    } catch {
        $resp = $_.Exception.Response
        if ($null -eq $resp) { throw }
        $code = [int]$resp.StatusCode
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            $text = $_.ErrorDetails.Message
        } else {
            $text = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd()
        }
    }
    "-> HTTP $code"
    if ($text) { $text | ConvertFrom-Json | ConvertTo-Json -Depth 10 }
}
# The two parties: name, id (any id from your database; a uuid fits) and e-mail. The owner and the contractor must be different.
$Parties = @{
    owner = 'Ahmed Ali'; ownerId = '5b3f0c52-1a7e-4c1d-9f0e-2d6a8b7c9e11'; ownerEmail = 'ahmed.ali@example.com'
    contractor = 'Al-Bina Co.'; contractorId = '9c4d7e20-6b1f-4a3e-8d52-0f1e2a3b4c55'; contractorEmail = 'info@al-bina.example.com'
}

function Step([string]$Title) { "`n=== $Title" }

Step 'Health'
Call GET '/health'

Step 'CREATE  POST /projects   (expect 201)'
Call POST '/projects' ($Parties + @{
    id = $Id; agreedPrice = 250000.5; currency = 'SAR'
    milestone = @(
        @{ description = 'Dig and pour the foundation';    startDate = '2026-10-01'; finishDate = '2026-10-20'; status = 'done' },
        @{ description = 'Build the ground floor columns'; startDate = '2026-10-21'; finishDate = $null;         status = 'proposed' }
    )
})

Step "READ  GET /projects/$Id   (expect 200, totalPaid 0)"
Call GET "/projects/$Id"

Step "ADD PAYMENT  POST /projects/$Id/payments   (expect 201)"
Call POST "/projects/$Id/payments" @{ id = 'PAY-1'; amount = 50000.25; date = '2026-10-03'; note = 'First payment' }

Step "UPDATE  PUT /projects/$Id   (expect 200; payments stay, price and tasks replaced; task 2 is now done)"
Call PUT "/projects/$Id" ($Parties + @{
    agreedPrice = 300000.5; currency = 'SAR'
    milestone = @(
        @{ description = 'Dig and pour the foundation';    startDate = '2026-10-01'; finishDate = '2026-10-20'; status = 'done' },
        @{ description = 'Build the ground floor columns'; startDate = '2026-10-21'; finishDate = '2026-11-15'; status = 'done' },
        @{ description = 'Roof slab';                      startDate = $null;        finishDate = $null;         status = 'proposed' }
    )
})

Step 'READ again   (totalPaid 50000.25, remaining 250000.25)'
Call GET "/projects/$Id"

Step "HISTORY  GET /projects/$Id/history   (3 versions, oldest first)"
Call GET "/projects/$Id/history"

Step 'ERROR: unknown task status   (expect 400)'
Call POST '/projects' ($Parties + @{ id = "$Id-Y"; agreedPrice = 1; milestone = @(@{ description = 't'; status = 'finished' }) })

Step 'ERROR: more than 2 decimals   (expect 400)'
Call POST '/projects' ($Parties + @{ id = "$Id-Z"; agreedPrice = 100.123 })

Step 'ERROR: create the same id again   (expect 409 ALREADY_EXISTS)'
Call POST '/projects' ($Parties + @{ id = $Id; agreedPrice = 1 })

Step 'ERROR: payment that would exceed the agreed price   (expect 400)'
Call POST "/projects/$Id/payments" @{ id = 'PAY-2'; amount = 999999; date = '2026-10-10' }

Step 'ERROR: the AdminOrg user tries to write   (expect 403 FORBIDDEN)'
Call POST '/projects' ($Parties + @{ id = "$Id-X"; agreedPrice = 1 }) @{ 'X-Org' = 'admin' }

Step 'OK: the AdminOrg user reads   (expect 200)'
Call GET "/projects/$Id" $null @{ 'X-Org' = 'admin' }

Step 'ERROR: project that does not exist   (expect 404)'
Call GET '/projects/NOPE'

"`nDone. The demo project $Id stays on the ledger (projects are never deleted)."

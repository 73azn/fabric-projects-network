#!/usr/bin/env bash
# Full walk-through of the API with curl: create, read, add payments, update, history, and the error cases.
#   docs/examples/crud-demo.sh [base-url]        (default http://localhost:4000)
#   If the server requires an API key:  API_KEY=... docs/examples/crud-demo.sh https://chain.example.com
# Needs only curl (jq is used for pretty output when it is installed). It creates ONE project named PRJ-DEMO-<time>.
set -u
B="${1:-http://localhost:4000}"
ID="PRJ-DEMO-$(date +%s)"
J='Content-Type: application/json'
AUTH=()
if [ -n "${API_KEY:-}" ]; then AUTH=(-H "Authorization: Bearer $API_KEY"); fi

# The two parties: name, id (any id from your database; a uuid fits) and e-mail. The owner and the contractor must be different.
P='"owner":"Ahmed Ali","ownerId":"5b3f0c52-1a7e-4c1d-9f0e-2d6a8b7c9e11","ownerEmail":"ahmed.ali@example.com","contractor":"Al-Bina Co.","contractorId":"9c4d7e20-6b1f-4a3e-8d52-0f1e2a3b4c55","contractorEmail":"info@al-bina.example.com"'

pretty() { if command -v jq > /dev/null 2>&1; then jq .; else cat; fi; }

# call <method> <path> <json-body or ""> [extra curl args]
call() {
  local method=$1 path=$2 body=$3; shift 3
  local out code
  if [ -n "$body" ]; then
    out=$(curl -s -w '\n%{http_code}' -X "$method" "$B$path" -H "$J" -d "$body" ${AUTH[@]+"${AUTH[@]}"} "$@")
  else
    out=$(curl -s -w '\n%{http_code}' -X "$method" "$B$path" ${AUTH[@]+"${AUTH[@]}"} "$@")
  fi
  code=${out##*$'\n'}; out=${out%$'\n'*}
  echo "-> HTTP $code"
  echo "$out" | pretty
}
step() { printf '\n=== %s\n' "$1"; }

step "Health"
call GET /health ""

step "CREATE  POST /projects   (expect 201)"
call POST /projects '{"id":"'"$ID"'",'"$P"',"agreedPrice":250000.5,"currency":"SAR","milestone":[{"description":"Dig and pour the foundation","startDate":"2026-10-01","finishDate":"2026-10-20","status": "done"},{"description":"Build the ground floor columns","startDate":"2026-10-21","finishDate":null,"status": "proposed"}]}'

step "READ  GET /projects/$ID   (expect 200, totalPaid 0)"
call GET "/projects/$ID" ""

step "ADD PAYMENT  POST /projects/$ID/payments   (expect 201)"
call POST "/projects/$ID/payments" '{"id":"PAY-1","amount":50000.25,"date":"2026-10-03","note":"First payment"}'

step "UPDATE  PUT /projects/$ID   (expect 200; payments stay, price and tasks replaced; task 2 is now done)"
call PUT "/projects/$ID" '{'"$P"',"agreedPrice":300000.5,"currency":"SAR","milestone":[{"description":"Dig and pour the foundation","startDate":"2026-10-01","finishDate":"2026-10-20","status": "done"},{"description":"Build the ground floor columns","startDate":"2026-10-21","finishDate":"2026-11-15","status": "done"},{"description":"Roof slab","startDate":null,"finishDate":null,"status": "proposed"}]}'

step "READ again   (totalPaid 50000.25, remaining 250000.25)"
call GET "/projects/$ID" ""

step "HISTORY  GET /projects/$ID/history   (3 versions, oldest first)"
call GET "/projects/$ID/history" ""

step "ERROR: unknown task status   (expect 400)"
call POST /projects '{"id":"'"$ID"'-Y",'"$P"',"agreedPrice":1,"milestone":[{"description":"t","status":"finished"}]}'

step "ERROR: more than 2 decimals   (expect 400)"
call POST /projects '{"id":"'"$ID"'-Z",'"$P"',"agreedPrice":100.123}'

step "ERROR: create the same id again   (expect 409 ALREADY_EXISTS)"
call POST /projects '{"id":"'"$ID"'",'"$P"',"agreedPrice":1}'

step "ERROR: payment that would exceed the agreed price   (expect 400)"
call POST "/projects/$ID/payments" '{"id":"PAY-2","amount":999999,"date":"2026-10-10"}'

step "ERROR: the AdminOrg user tries to write   (expect 403 FORBIDDEN)"
call POST /projects '{"id":"'"$ID"'-X",'"$P"',"agreedPrice":1}' -H 'X-Org: admin'

step "OK: the AdminOrg user reads   (expect 200)"
call GET "/projects/$ID" "" -H 'X-Org: admin'

step "ERROR: project that does not exist   (expect 404)"
call GET /projects/NOPE ""

printf '\nDone. The demo project %s stays on the ledger (projects are never deleted).\n' "$ID"

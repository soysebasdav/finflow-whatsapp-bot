param(
  [Parameter(Mandatory=$true)][string]$BaseUrl,
  [Parameter(Mandatory=$true)][string]$Token,
  [string]$GroupName = "Pagos"
)

$body = @{
  eventType = "manual_test"
  groupTarget = ""
  groupName = $GroupName
  message = "Prueba manual desde bot en Railway"
  meta = @{ source = "railway-powershell" }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Uri "$BaseUrl/api/whatsapp/send-group" `
  -Method Post `
  -ContentType "application/json" `
  -Headers @{ "Authorization" = "Bearer $Token" } `
  -Body $body

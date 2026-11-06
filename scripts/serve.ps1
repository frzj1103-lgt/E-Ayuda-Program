$ErrorActionPreference = "Stop"

$siteRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path.TrimEnd("\")
$rootPrefix = "$siteRoot\"
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:8080/")

try {
  $listener.Start()
  Write-Output "E-Ayuda dev server listening at http://localhost:8080/"

  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $response = $context.Response

    try {
      if ($context.Request.HttpMethod -notin @("GET", "HEAD")) {
        $response.StatusCode = 405
        $response.Headers.Add("Allow", "GET, HEAD")
        continue
      }

      $requestPath = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart("/"))
      if ([string]::IsNullOrWhiteSpace($requestPath)) {
        $requestPath = "index.html"
      }
      $requestPath = $requestPath.Replace("/", "\")
      $filePath = [System.IO.Path]::GetFullPath((Join-Path $siteRoot $requestPath))

      if (-not $filePath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        $response.StatusCode = 403
        continue
      }
      if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
        $response.StatusCode = 404
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("Not found")
        $response.ContentType = "text/plain; charset=utf-8"
        $response.ContentLength64 = $bytes.Length
        if ($context.Request.HttpMethod -ne "HEAD") {
          $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        continue
      }

      $contentType = switch ([System.IO.Path]::GetExtension($filePath).ToLowerInvariant()) {
        ".html" { "text/html; charset=utf-8" }
        ".css"  { "text/css; charset=utf-8" }
        ".js"   { "text/javascript; charset=utf-8" }
        ".json" { "application/json; charset=utf-8" }
        ".svg"  { "image/svg+xml" }
        ".png"  { "image/png" }
        ".jpg"  { "image/jpeg" }
        ".jpeg" { "image/jpeg" }
        ".ico"  { "image/x-icon" }
        default { "application/octet-stream" }
      }
      $bytes = [System.IO.File]::ReadAllBytes($filePath)
      $response.StatusCode = 200
      $response.ContentType = $contentType
      $response.ContentLength64 = $bytes.Length
      $response.Headers.Add("X-Content-Type-Options", "nosniff")
      if ($context.Request.HttpMethod -ne "HEAD") {
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    } finally {
      $response.Close()
    }
  }
} finally {
  if ($listener.IsListening) {
    $listener.Stop()
  }
  $listener.Close()
  Write-Output "E-Ayuda dev server stopped"
}

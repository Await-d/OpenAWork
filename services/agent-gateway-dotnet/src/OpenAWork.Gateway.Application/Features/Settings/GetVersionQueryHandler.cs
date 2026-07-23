using System.Reflection;
using System.Text.Json;
using MediatR;
using OpenAWork.Gateway.Contracts.Settings;

namespace OpenAWork.Gateway.Application.Features.Settings;

public sealed class GetVersionQueryHandler : IRequestHandler<GetVersionQuery, VersionResponse>
{
    private static readonly HttpClient HttpClient = new();

    // Keep in sync with packages/shared/src/release-endpoints.ts
    private const string PreviewLatestJson =
        "https://github.com/Await-d/OpenAWork/releases/download/desktop-latest-preview/latest.json";
    private const string StableLatestJson =
        "https://github.com/Await-d/OpenAWork/releases/latest/download/latest.json";
    private const string GithubLatestApi =
        "https://api.github.com/repos/Await-d/OpenAWork/releases/latest";

    public async Task<VersionResponse> Handle(GetVersionQuery request, CancellationToken cancellationToken)
    {
        // Prefer the assembly informational version (SemVer) when present; fall back to assembly version.
        var currentVersion =
            Assembly.GetEntryAssembly()?.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
            ?? Assembly.GetEntryAssembly()?.GetName().Version?.ToString()
            ?? "1.0.0";
        currentVersion = NormalizeVersion(currentVersion) ?? currentVersion;

        var channel = NormalizeChannel(request.Channel);

        // Isolate failures per endpoint so a channel timeout/DNS error still allows
        // the GitHub API fallback (mirrors Node release-version-check).
        var channelUrl = channel == "stable" ? StableLatestJson : PreviewLatestJson;
        var latestVersion =
            await TryReadUpdaterJsonVersionAsync(channelUrl, cancellationToken)
            ?? await TryReadGithubApiVersionAsync(cancellationToken);

        var updateAvailable = latestVersion is not null && CompareSemver(latestVersion, currentVersion) > 0;
        var checkError = latestVersion is null ? "Unable to reach GitHub releases" : null;

        return new VersionResponse(currentVersion, latestVersion, updateAvailable, checkError, DateTimeOffset.UtcNow.ToString("O"));
    }

    private static string NormalizeChannel(string? channel)
    {
        return string.Equals(channel, "stable", StringComparison.OrdinalIgnoreCase) ? "stable" : "preview";
    }

    private static async Task<string?> TryReadUpdaterJsonVersionAsync(string url, CancellationToken cancellationToken)
    {
        try
        {
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(TimeSpan.FromSeconds(5));
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.TryAddWithoutValidation("User-Agent", "OpenAWork-gateway-version-check");
            request.Headers.TryAddWithoutValidation("Accept", "application/json");

            using var response = await HttpClient.SendAsync(request, timeoutCts.Token);
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            await using var stream = await response.Content.ReadAsStreamAsync(timeoutCts.Token);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: timeoutCts.Token);
            if (document.RootElement.TryGetProperty("version", out var versionElement)
                && versionElement.ValueKind == JsonValueKind.String)
            {
                return NormalizeVersion(versionElement.GetString());
            }

            return null;
        }
        catch
        {
            // Network / timeout / parse failures must not abort later candidates.
            return null;
        }
    }

    private static async Task<string?> TryReadGithubApiVersionAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(TimeSpan.FromSeconds(5));
            using var request = new HttpRequestMessage(HttpMethod.Get, GithubLatestApi);
            request.Headers.TryAddWithoutValidation("User-Agent", "OpenAWork-gateway-version-check");
            request.Headers.TryAddWithoutValidation("Accept", "application/vnd.github+json");

            using var response = await HttpClient.SendAsync(request, timeoutCts.Token);
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            await using var stream = await response.Content.ReadAsStreamAsync(timeoutCts.Token);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: timeoutCts.Token);
            if (document.RootElement.TryGetProperty("tag_name", out var tagElement)
                && tagElement.ValueKind == JsonValueKind.String)
            {
                return NormalizeVersion(tagElement.GetString());
            }

            if (document.RootElement.TryGetProperty("name", out var nameElement)
                && nameElement.ValueKind == JsonValueKind.String)
            {
                return NormalizeVersion(nameElement.GetString());
            }

            return null;
        }
        catch
        {
            return null;
        }
    }

    private static string? NormalizeVersion(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var trimmed = raw.Trim();
        // Strip optional build metadata / commit suffix from informational versions.
        var plusIndex = trimmed.IndexOf('+');
        if (plusIndex >= 0)
        {
            trimmed = trimmed[..plusIndex];
        }

        if (trimmed.StartsWith("v", StringComparison.OrdinalIgnoreCase))
        {
            trimmed = trimmed[1..];
        }

        return string.IsNullOrWhiteSpace(trimmed) ? null : trimmed;
    }

    private static int CompareSemver(string left, string right)
    {
        var leftParts = left.Split(['.', '+', '-'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(ParsePart)
            .ToArray();
        var rightParts = right.Split(['.', '+', '-'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(ParsePart)
            .ToArray();
        var length = Math.Max(leftParts.Length, rightParts.Length);

        for (var index = 0; index < length; index++)
        {
            var leftValue = index < leftParts.Length ? leftParts[index] : 0;
            var rightValue = index < rightParts.Length ? rightParts[index] : 0;
            if (leftValue != rightValue)
            {
                return leftValue.CompareTo(rightValue);
            }
        }

        return 0;
    }

    private static int ParsePart(string value)
    {
        var digits = new string(value.TakeWhile(char.IsDigit).ToArray());
        return int.TryParse(digits, out var parsed) ? parsed : 0;
    }
}

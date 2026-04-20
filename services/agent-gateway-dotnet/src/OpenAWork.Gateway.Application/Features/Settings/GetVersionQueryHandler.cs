using System.Reflection;
using System.Text.Json;
using MediatR;
using OpenAWork.Gateway.Contracts.Settings;

namespace OpenAWork.Gateway.Application.Features.Settings;

public sealed class GetVersionQueryHandler : IRequestHandler<GetVersionQuery, VersionResponse>
{
    private static readonly HttpClient HttpClient = new();

    public async Task<VersionResponse> Handle(GetVersionQuery request, CancellationToken cancellationToken)
    {
        var currentVersion = Assembly.GetEntryAssembly()?.GetName().Version?.ToString() ?? "1.0.0";
        string? latestVersion = null;
        var updateAvailable = false;
        string? checkError = null;

        try
        {
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(TimeSpan.FromSeconds(5));
            using var response = await HttpClient.GetAsync("https://registry.npmjs.org/@openAwork/agent-gateway/latest", timeoutCts.Token);
            if (response.IsSuccessStatusCode)
            {
                using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(timeoutCts.Token));
                latestVersion = document.RootElement.TryGetProperty("version", out var versionElement) && versionElement.ValueKind == JsonValueKind.String
                    ? versionElement.GetString()
                    : null;
                updateAvailable = latestVersion is not null && CompareSemver(latestVersion, currentVersion) > 0;
            }
        }
        catch
        {
            checkError = "Unable to reach npm registry";
        }

        return new VersionResponse(currentVersion, latestVersion, updateAvailable, checkError, DateTimeOffset.UtcNow.ToString("O"));
    }

    private static int CompareSemver(string left, string right)
    {
        var leftParts = left.Split('.', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Select(ParsePart).ToArray();
        var rightParts = right.Split('.', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Select(ParsePart).ToArray();
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

using System.Text;
using System.Text.Json;
using OpenAWork.Gateway.Application.Abstractions.Settings;

namespace OpenAWork.Gateway.Infrastructure.Settings;

public sealed class WorkflowLlmClient : IWorkflowLlmClient
{
    private static readonly HttpClient HttpClient = new();

    public async Task<string> CompleteAsync(string apiBaseUrl, string apiKey, string model, string prompt, double temperature, CancellationToken cancellationToken)
    {
        var protocol = ResolveProtocol(apiBaseUrl, model);
        var url = $"{apiBaseUrl.TrimEnd('/')}/{(protocol == "responses" ? "responses" : "chat/completions")}";
        var body = protocol == "responses"
            ? new Dictionary<string, object?>
            {
                ["model"] = model,
                ["input"] = prompt,
                ["temperature"] = temperature,
                ["max_output_tokens"] = 2048,
                ["stream"] = false,
            }
            : new Dictionary<string, object?>
            {
                ["model"] = model,
                ["messages"] = new[] { new { role = "user", content = prompt } },
                ["temperature"] = temperature,
                ["max_tokens"] = 2048,
                ["stream"] = false,
            };

        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", apiKey);

        using var response = await HttpClient.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var detail = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException($"LLM request failed: {detail}");
        }

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        return ExtractText(document.RootElement);
    }

    private static string ResolveProtocol(string apiBaseUrl, string model)
    {
        try
        {
            var hostname = new Uri(apiBaseUrl).Host.ToLowerInvariant();
            if (hostname == "api.openai.com" && (model.StartsWith("gpt-", StringComparison.OrdinalIgnoreCase) || model.StartsWith("o", StringComparison.OrdinalIgnoreCase)))
            {
                return "responses";
            }
        }
        catch
        {
        }

        return "chat_completions";
    }

    private static string ExtractText(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.String)
        {
            return value.GetString() ?? string.Empty;
        }

        if (value.ValueKind == JsonValueKind.Array)
        {
            return string.Concat(value.EnumerateArray().Select(ExtractText));
        }

        if (value.ValueKind != JsonValueKind.Object)
        {
            return string.Empty;
        }

        foreach (var propertyName in new[] { "output_text", "choices", "output", "message", "content", "text", "value" })
        {
            if (value.TryGetProperty(propertyName, out var property))
            {
                var text = ExtractText(property);
                if (!string.IsNullOrWhiteSpace(text))
                {
                    return text;
                }
            }
        }

        return string.Empty;
    }
}

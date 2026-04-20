using System.Text.Json;
using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Observability;
using OpenAWork.Gateway.Contracts.Settings;

namespace OpenAWork.Gateway.Application.Features.Settings;

public sealed class GetDevLogsQueryHandler(
    ICurrentUser currentUser,
    IRequestWorkflowLogStore requestWorkflowLogStore) : IRequestHandler<GetDevLogsQuery, DevLogsResponse>
{
    public async Task<DevLogsResponse> Handle(GetDevLogsQuery request, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        var rows = await requestWorkflowLogStore.ListByUserAsync(userId, 100, cancellationToken);

        var logs = rows.Select((row) => new DevLogItemResponse(
            Id: $"workflow-{row.Id}",
            SessionId: row.SessionId,
            RequestId: row.RequestId,
            Level: row.StatusCode >= 400 ? "error" : "info",
            Message: $"{row.Method} {row.Path} → {row.StatusCode}",
            ToolName: "request_workflow",
            DurationMs: null,
            CreatedAt: row.CreatedAtUtc.ToString("O"),
            Input: null,
            Output: TryParseJson(row.WorkflowJson),
            IsError: row.StatusCode >= 400,
            Source: "workflow")).ToArray();

        return new DevLogsResponse(logs);
    }

    private string RequireUserId()
    {
        if (!currentUser.IsAuthenticated || string.IsNullOrWhiteSpace(currentUser.UserId))
        {
            throw new UnauthorizedAccessException("Authenticated user is required.");
        }

        return currentUser.UserId;
    }

    private static JsonElement? TryParseJson(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(value);
            return document.RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

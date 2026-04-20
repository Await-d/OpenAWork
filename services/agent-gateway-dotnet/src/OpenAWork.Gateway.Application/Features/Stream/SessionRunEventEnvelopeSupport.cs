using System.Text.Json;

namespace OpenAWork.Gateway.Application.Features.Stream;

internal static class SessionRunEventEnvelopeSupport
{
    public static SessionRunEventBookendDescriptor? DeriveBookend(JsonElement eventPayload)
    {
        var type = ReadString(eventPayload, "type");
        return type switch
        {
            "done" => DeriveDoneBookend(eventPayload),
            "error" => new SessionRunEventBookendDescriptor("run_failed", terminal: true, replayable: true),
            "permission_asked" => new SessionRunEventBookendDescriptor(
                "interaction_wait",
                terminal: false,
                replayable: true,
                interactionType: "permission",
                requestId: ReadString(eventPayload, "requestId")),
            "question_asked" => new SessionRunEventBookendDescriptor(
                "interaction_wait",
                terminal: false,
                replayable: true,
                interactionType: "question",
                requestId: ReadString(eventPayload, "requestId")),
            "permission_replied" => new SessionRunEventBookendDescriptor(
                "interaction_resumed",
                terminal: false,
                replayable: false,
                interactionType: "permission",
                requestId: ReadString(eventPayload, "requestId")),
            "question_replied" => new SessionRunEventBookendDescriptor(
                "interaction_resumed",
                terminal: false,
                replayable: false,
                interactionType: "question",
                requestId: ReadString(eventPayload, "requestId")),
            _ => null,
        };
    }

    public static object BuildAttachEnvelope(string clientRequestId, JsonElement eventPayload, long seq)
    {
        var aggregateId = ReadString(eventPayload, "runId") ?? clientRequestId;
        var timestamp = ReadLong(eventPayload, "occurredAt") ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var bookend = DeriveBookend(eventPayload);

        return new
        {
            eventId = ReadString(eventPayload, "eventId") ?? $"{aggregateId}:evt:{seq}",
            aggregateType = "run",
            aggregateId,
            seq,
            version = 1,
            timestamp,
            payload = new
            {
                clientRequestId,
                cursor = new
                {
                    clientRequestId,
                    seq,
                },
                deliveryState = "delivered",
                outputOffset = seq,
                bookend = BuildBookendPayload(bookend),
                @event = eventPayload,
            },
        };
    }

    private static SessionRunEventBookendDescriptor DeriveDoneBookend(JsonElement eventPayload)
    {
        var stopReason = ReadString(eventPayload, "stopReason");
        return stopReason switch
        {
            "tool_use" => new SessionRunEventBookendDescriptor(
                "tool_handoff",
                terminal: false,
                replayable: false,
                stopReason: stopReason),
            "tool_permission" => new SessionRunEventBookendDescriptor(
                "permission_paused",
                terminal: false,
                replayable: true,
                stopReason: stopReason),
            "cancelled" => new SessionRunEventBookendDescriptor(
                "run_cancelled",
                terminal: true,
                replayable: true,
                stopReason: stopReason),
            _ => new SessionRunEventBookendDescriptor(
                "run_completed",
                terminal: true,
                replayable: true,
                stopReason: stopReason),
        };
    }

    private static object? BuildBookendPayload(SessionRunEventBookendDescriptor? descriptor)
    {
        if (descriptor is null)
        {
            return null;
        }

        if (!string.IsNullOrWhiteSpace(descriptor.StopReason))
        {
            return new
            {
                kind = descriptor.Kind,
                terminal = descriptor.Terminal,
                replayable = descriptor.Replayable,
                stopReason = descriptor.StopReason,
            };
        }

        if (!string.IsNullOrWhiteSpace(descriptor.InteractionType))
        {
            return new
            {
                kind = descriptor.Kind,
                terminal = descriptor.Terminal,
                replayable = descriptor.Replayable,
                interactionType = descriptor.InteractionType,
                requestId = descriptor.RequestId,
            };
        }

        return new
        {
            kind = descriptor.Kind,
            terminal = descriptor.Terminal,
            replayable = descriptor.Replayable,
        };
    }

    private static long? ReadLong(JsonElement element, string propertyName)
        => element.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.Number && property.TryGetInt64(out var value)
            ? value
            : null;

    private static string? ReadString(JsonElement element, string propertyName)
        => element.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;
}

internal sealed record SessionRunEventBookendDescriptor(
    string Kind,
    bool Terminal,
    bool Replayable,
    string? StopReason = null,
    string? InteractionType = null,
    string? RequestId = null);

using System.Text.Json;

namespace OpenAWork.Gateway.Application.Abstractions.Streaming;

public interface ISessionRunEventBroadcaster
{
    Action Subscribe(string sessionId, Action<JsonElement, SessionRunEventBroadcastRecord> handler);

    void Publish(string sessionId, JsonElement eventPayload, SessionRunEventBroadcastRecord meta);
}

public sealed record SessionRunEventBroadcastRecord(
    string ClientRequestId,
    long Seq);

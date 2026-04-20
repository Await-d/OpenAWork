using System.Collections.Concurrent;
using System.Text.Json;
using OpenAWork.Gateway.Application.Abstractions.Streaming;

namespace OpenAWork.Gateway.Infrastructure.Streaming;

public sealed class InMemorySessionRunEventBroadcaster : ISessionRunEventBroadcaster
{
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<Guid, Action<JsonElement, SessionRunEventBroadcastRecord>>> _handlers = new(StringComparer.Ordinal);

    public Action Subscribe(string sessionId, Action<JsonElement, SessionRunEventBroadcastRecord> handler)
    {
        var subscriptionId = Guid.NewGuid();
        var handlers = _handlers.GetOrAdd(sessionId, static _ => new ConcurrentDictionary<Guid, Action<JsonElement, SessionRunEventBroadcastRecord>>());
        handlers[subscriptionId] = handler;

        return () =>
        {
            if (!_handlers.TryGetValue(sessionId, out var currentHandlers))
            {
                return;
            }

            currentHandlers.TryRemove(subscriptionId, out _);
            if (currentHandlers.IsEmpty)
            {
                _handlers.TryRemove(sessionId, out _);
            }
        };
    }

    public void Publish(string sessionId, JsonElement eventPayload, SessionRunEventBroadcastRecord meta)
    {
        if (!_handlers.TryGetValue(sessionId, out var handlers) || handlers.IsEmpty)
        {
            return;
        }

        var failedSubscriptions = new List<Guid>();
        foreach (var pair in handlers)
        {
            try
            {
                pair.Value(eventPayload, meta);
            }
            catch (Exception)
            {
                failedSubscriptions.Add(pair.Key);
            }
        }

        if (failedSubscriptions.Count == 0)
        {
            return;
        }

        foreach (var subscriptionId in failedSubscriptions)
        {
            handlers.TryRemove(subscriptionId, out _);
        }

        if (handlers.IsEmpty)
        {
            _handlers.TryRemove(sessionId, out _);
        }
    }
}

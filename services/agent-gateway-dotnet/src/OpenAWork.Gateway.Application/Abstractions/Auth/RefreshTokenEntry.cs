namespace OpenAWork.Gateway.Application.Abstractions.Auth;

public sealed record RefreshTokenEntry(
    string Id,
    string UserId,
    string TokenHash,
    DateTimeOffset ExpiresAtUtc);

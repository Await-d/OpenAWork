namespace OpenAWork.Gateway.Application.Abstractions.Auth;

public sealed record GeneratedRefreshToken(
    string Token,
    string TokenHash,
    DateTimeOffset ExpiresAtUtc);
